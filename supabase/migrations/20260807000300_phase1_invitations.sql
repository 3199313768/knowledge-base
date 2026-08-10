create extension if not exists pgcrypto with schema extensions;

update public.workspace_invitations
set status = 'revoked',
    revoked_at = coalesce(revoked_at, now())
where status = 'pending';

alter table public.workspace_invitations
  add column token_digest bytea not null
    default extensions.digest(gen_random_uuid()::text, 'sha256'),
  add constraint workspace_invitations_token_digest_length
    check (octet_length(token_digest) = 32),
  add constraint workspace_invitations_state_fields
    check (
      (
        status in ('pending', 'expired')
        and accepted_by is null
        and accepted_at is null
        and revoked_at is null
      )
      or (
        status = 'accepted'
        and accepted_by is not null
        and accepted_at is not null
        and revoked_at is null
      )
      or (
        status = 'revoked'
        and accepted_by is null
        and accepted_at is null
        and revoked_at is not null
      )
    );

alter table public.workspace_invitations
  alter column token_digest drop default;

create unique index workspace_invitations_token_digest_unique
  on public.workspace_invitations (token_digest);

create policy workspace_invitations_select_admin_or_invitee
on public.workspace_invitations
for select
to authenticated
using (
  private.is_workspace_admin(workspace_id)
  or (
    status = 'pending'
    and expires_at > now()
    and lower(email::text) = lower(
      btrim(coalesce((select auth.jwt() ->> 'email'), ''))
    )
  )
);

revoke insert, update, delete on public.workspace_invitations
  from public, anon, authenticated;

create or replace function public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email extensions.citext
)
returns table (
  invitation_id uuid,
  invitation_token uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email extensions.citext := lower(
    btrim(coalesce(p_email::text, ''))
  )::extensions.citext;
  v_invitation_id uuid;
  v_invitation_token uuid := gen_random_uuid();
  v_expires_at timestamptz := now() + interval '7 days';
  v_replaced_id uuid;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_workspace_id is null then
    raise exception 'workspace is required';
  end if;

  perform 1
  from public.workspaces w
  where w.id = p_workspace_id
  for update;
  if not found then
    raise exception 'workspace not found';
  end if;
  if not private.is_workspace_admin(p_workspace_id) then
    raise exception 'workspace admin required';
  end if;
  if v_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid invitation email';
  end if;
  if exists (
    select 1
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = p_workspace_id
      and lower(u.email) = lower(v_email::text)
  ) then
    raise exception 'user is already a workspace member';
  end if;

  update public.workspace_invitations i
  set status = 'expired'
  where i.workspace_id = p_workspace_id
    and i.email = v_email
    and i.status = 'pending'
    and i.expires_at <= now();

  for v_replaced_id in
    update public.workspace_invitations i
    set status = 'revoked',
        revoked_at = now()
    where i.workspace_id = p_workspace_id
      and i.email = v_email
      and i.status = 'pending'
    returning i.id
  loop
    insert into public.audit_events (
      workspace_id,
      actor_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      p_workspace_id,
      v_actor,
      'invitation.revoked',
      'invitation',
      v_replaced_id,
      jsonb_build_object('reason', 'replaced')
    );
  end loop;

  insert into public.workspace_invitations (
    workspace_id,
    email,
    invited_by,
    expires_at,
    token_digest
  )
  values (
    p_workspace_id,
    v_email,
    v_actor,
    v_expires_at,
    extensions.digest(v_invitation_token::text, 'sha256')
  )
  returning id into v_invitation_id;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    p_workspace_id,
    v_actor,
    'invitation.created',
    'invitation',
    v_invitation_id
  );

  return query
  select v_invitation_id, v_invitation_token, v_expires_at;
end;
$$;

create or replace function public.revoke_workspace_invitation(
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_workspace_id uuid;
  v_status public.invitation_status;
  v_expires_at timestamptz;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  select i.workspace_id
  into v_workspace_id
  from public.workspace_invitations i
  where i.id = p_invitation_id;
  if not found then
    raise exception 'invitation not found';
  end if;

  perform 1
  from public.workspaces w
  where w.id = v_workspace_id
  for update;
  if not found then
    raise exception 'workspace not found';
  end if;
  if not private.is_workspace_admin(v_workspace_id) then
    raise exception 'workspace admin required';
  end if;

  select i.status, i.expires_at
  into v_status, v_expires_at
  from public.workspace_invitations i
  where i.id = p_invitation_id
  for update;

  if v_status = 'accepted' then
    raise exception 'invitation has already been accepted';
  elsif v_status = 'revoked' then
    raise exception 'invitation has been revoked';
  elsif v_status = 'expired' or v_expires_at <= now() then
    raise exception 'invitation has expired';
  elsif v_status <> 'pending' then
    raise exception 'invitation is not pending';
  end if;

  update public.workspace_invitations
  set status = 'revoked',
      revoked_at = now()
  where id = p_invitation_id;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    v_workspace_id,
    v_actor,
    'invitation.revoked',
    'invitation',
    p_invitation_id
  );
end;
$$;

create or replace function public.list_my_pending_invitations()
returns table (
  id uuid,
  workspace_id uuid,
  workspace_name text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email text := lower(
    btrim(coalesce((select auth.jwt() ->> 'email'), ''))
  );
begin
  if v_actor is null or v_email = '' then
    raise exception 'authentication with email required';
  end if;

  return query
  select i.id, i.workspace_id, w.name, i.expires_at
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  where i.status = 'pending'
    and i.expires_at > now()
    and lower(i.email::text) = v_email
  order by i.expires_at;
end;
$$;

create or replace function public.accept_workspace_invitation(
  p_invitation_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_email text := lower(
    btrim(coalesce((select auth.jwt() ->> 'email'), ''))
  );
  v_invitation_id uuid;
  v_workspace_id uuid;
  v_invitation_email text;
  v_status public.invitation_status;
  v_expires_at timestamptz;
begin
  if v_actor is null or v_actor_email = '' then
    raise exception 'authentication with email required';
  end if;
  if p_invitation_token is null then
    raise exception 'invitation token is required';
  end if;

  select i.workspace_id
  into v_workspace_id
  from public.workspace_invitations i
  where i.token_digest = extensions.digest(
    p_invitation_token::text,
    'sha256'
  );
  if not found then
    raise exception 'invitation not found';
  end if;

  perform 1
  from public.workspaces w
  where w.id = v_workspace_id
  for update;
  if not found then
    raise exception 'workspace not found';
  end if;

  select i.id, i.email::text, i.status, i.expires_at
  into v_invitation_id, v_invitation_email, v_status, v_expires_at
  from public.workspace_invitations i
  where i.token_digest = extensions.digest(
    p_invitation_token::text,
    'sha256'
  )
  for update;
  if not found then
    raise exception 'invitation not found';
  end if;

  if lower(v_invitation_email) <> v_actor_email then
    raise exception 'invitation email does not match authenticated email';
  end if;
  if v_status = 'accepted' then
    raise exception 'invitation has already been accepted';
  elsif v_status = 'revoked' then
    raise exception 'invitation has been revoked';
  elsif v_status = 'expired' or v_expires_at <= now() then
    raise exception 'invitation has expired';
  elsif v_status <> 'pending' then
    raise exception 'invitation is not pending';
  end if;

  insert into public.memberships (workspace_id, user_id, role)
  values (v_workspace_id, v_actor, 'member')
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set status = 'accepted',
      accepted_by = v_actor,
      accepted_at = now()
  where id = v_invitation_id;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    v_workspace_id,
    v_actor,
    'invitation.accepted',
    'invitation',
    v_invitation_id
  );

  return v_workspace_id;
end;
$$;

revoke all on function public.create_workspace_invitation(
  uuid,
  extensions.citext
) from public, anon, authenticated;
revoke all on function public.revoke_workspace_invitation(uuid)
  from public, anon, authenticated;
revoke all on function public.list_my_pending_invitations()
  from public, anon, authenticated;
revoke all on function public.accept_workspace_invitation(uuid)
  from public, anon, authenticated;

grant execute on function public.create_workspace_invitation(
  uuid,
  extensions.citext
) to authenticated;
grant execute on function public.revoke_workspace_invitation(uuid)
  to authenticated;
grant execute on function public.list_my_pending_invitations()
  to authenticated;
grant execute on function public.accept_workspace_invitation(uuid)
  to authenticated;
