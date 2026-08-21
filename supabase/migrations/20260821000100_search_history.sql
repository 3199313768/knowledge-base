create or replace function private.normalize_search_history_query(p_query text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      p_query,
      '(^[[:space:]]+)|([[:space:]]+$)',
      '',
      'g'
    )
  );
$$;

revoke all on function private.normalize_search_history_query(text) from public, anon, authenticated;

create table public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  query text not null check (
    char_length(private.normalize_search_history_query(query)) between 1 and 500
  ),
  normalized_query text not null check (
    normalized_query = private.normalize_search_history_query(query)
    and char_length(normalized_query) between 1 and 500
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id, normalized_query)
);

create index search_history_user_workspace_updated_idx
  on public.search_history(user_id, workspace_id, updated_at desc);

create index search_history_workspace_updated_idx
  on public.search_history(workspace_id, updated_at desc);

create or replace function private.touch_search_history_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.protect_search_history_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.workspace_id is distinct from old.workspace_id
  then
    raise exception 'search history ownership is immutable';
  end if;

  new.created_at = old.created_at;
  return new;
end;
$$;

revoke all on function private.touch_search_history_updated_at() from public, anon, authenticated;
revoke all on function private.protect_search_history_identity() from public, anon, authenticated;

create trigger search_history_protect_identity
before update on public.search_history
for each row
execute function private.protect_search_history_identity();

create trigger search_history_touch_updated_at
before update on public.search_history
for each row
execute function private.touch_search_history_updated_at();

alter table public.search_history enable row level security;

revoke all on public.search_history from public, anon, authenticated;
grant select, delete on public.search_history to authenticated;

create policy search_history_select_own_workspace
on public.search_history
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
);

create policy search_history_insert_own_workspace
on public.search_history
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
);

create policy search_history_update_own_workspace
on public.search_history
for update to authenticated
using (
  user_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
)
with check (
  user_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
);

create policy search_history_delete_own_workspace
on public.search_history
for delete to authenticated
using (
  user_id = (select auth.uid())
  and private.is_workspace_member(workspace_id)
);

create or replace function public.record_search_history(
  p_workspace_id uuid,
  p_query text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_query text := private.normalize_search_history_query(p_query);
  v_normalized_query text := v_query;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_workspace_id is null then
    raise exception 'workspace is required' using errcode = '22023';
  end if;
  if v_query is null or char_length(v_query) not between 1 and 500 then
    raise exception 'query must contain 1 to 500 characters' using errcode = '22023';
  end if;

  -- Lock this user's membership row to serialize concurrent records for the
  -- same workspace before pruning records beyond the 20-item retention limit.
  perform 1
  from public.memberships
  where workspace_id = p_workspace_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'workspace membership required' using errcode = '42501';
  end if;

  insert into public.search_history (
    user_id,
    workspace_id,
    query,
    normalized_query
  )
  values (
    v_user_id,
    p_workspace_id,
    v_query,
    v_normalized_query
  )
  on conflict (user_id, workspace_id, normalized_query)
  do update set query = excluded.query;

  delete from public.search_history h
  where h.user_id = v_user_id
    and h.workspace_id = p_workspace_id
    and h.id in (
      select stale.id
      from public.search_history stale
      where stale.user_id = v_user_id
        and stale.workspace_id = p_workspace_id
      order by stale.updated_at desc, stale.id desc
      offset 20
    );
end;
$$;

revoke all on function public.record_search_history(uuid, text) from public, anon, authenticated;
grant execute on function public.record_search_history(uuid, text) to authenticated;
