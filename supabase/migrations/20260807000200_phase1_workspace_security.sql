create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  );
$$;

create or replace function private.can_manage_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.files f
    where f.id = p_file_id
      and f.deleted_at is null
      and private.is_workspace_member(f.workspace_id)
      and (
        f.uploader_id = (select auth.uid())
        or private.is_workspace_admin(f.workspace_id)
      )
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon, authenticated;
revoke all on function private.is_workspace_admin(uuid) from public, anon, authenticated;
revoke all on function private.can_manage_file(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;
grant execute on function private.can_manage_file(uuid) to authenticated;

revoke all on public.workspaces, public.memberships,
  public.workspace_invitations, public.files, public.file_versions,
  public.processing_jobs, public.content_chunks, public.devices,
  public.audit_events from public, anon, authenticated;

grant select on public.workspaces, public.memberships,
  public.workspace_invitations, public.files, public.file_versions,
  public.processing_jobs, public.content_chunks, public.audit_events
  to authenticated;
grant select, insert, update, delete on public.devices to authenticated;

create policy workspaces_select_member on public.workspaces
for select to authenticated
using (private.is_workspace_member(id));

create policy memberships_select_member on public.memberships
for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy files_select_member on public.files
for select to authenticated
using (deleted_at is null and private.is_workspace_member(workspace_id));

create policy file_versions_select_member on public.file_versions
for select to authenticated
using (
  private.is_workspace_member(workspace_id)
  and exists (
    select 1
    from public.files f
    where f.id = file_id
      and f.deleted_at is null
  )
);

create policy processing_jobs_select_member on public.processing_jobs
for select to authenticated
using (
  exists (
    select 1
    from public.file_versions v
    join public.files f on f.id = v.file_id
    where v.id = version_id
      and f.deleted_at is null
      and private.is_workspace_member(v.workspace_id)
  )
);

create policy content_chunks_select_current_member on public.content_chunks
for select to authenticated
using (
  exists (
    select 1
    from public.file_versions v
    join public.files f on f.current_version_id = v.id
    where v.id = version_id
      and f.deleted_at is null
      and private.is_workspace_member(v.workspace_id)
  )
);

create policy audit_events_select_admin on public.audit_events
for select to authenticated
using (private.is_workspace_admin(workspace_id));

create policy devices_select_own on public.devices
for select to authenticated
using (user_id = (select auth.uid()));

create policy devices_insert_own on public.devices
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy devices_update_own on public.devices
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy devices_delete_own on public.devices
for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
    raise exception 'workspace name must contain 1 to 100 characters';
  end if;

  insert into public.workspaces (name, created_by)
  values (btrim(p_name), v_user_id)
  returning id into v_workspace_id;

  insert into public.memberships (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'admin');

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    v_workspace_id,
    v_user_id,
    'workspace.created',
    'workspace',
    v_workspace_id
  );

  return v_workspace_id;
end;
$$;

create or replace function public.rename_workspace(
  p_workspace_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then
    raise exception 'workspace name must contain 1 to 100 characters';
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

  update public.workspaces
  set name = btrim(p_name),
      updated_at = now()
  where id = p_workspace_id;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    p_workspace_id,
    v_user_id,
    'workspace.renamed',
    'workspace',
    p_workspace_id
  );
end;
$$;

create or replace function public.set_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role public.workspace_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_current_role public.workspace_role;
  v_admin_count bigint;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if p_role is null then
    raise exception 'workspace role is required';
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

  select m.role
  into v_current_role
  from public.memberships m
  where m.workspace_id = p_workspace_id
    and m.user_id = p_user_id;
  if not found then
    raise exception 'workspace membership not found';
  end if;

  if v_current_role = 'admin' and p_role = 'member' then
    select count(*)
    into v_admin_count
    from public.memberships m
    where m.workspace_id = p_workspace_id
      and m.role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'workspace must retain an admin';
    end if;
  end if;

  update public.memberships
  set role = p_role
  where workspace_id = p_workspace_id
    and user_id = p_user_id;

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
    v_user_id,
    'membership.role_changed',
    'membership',
    p_user_id,
    jsonb_build_object(
      'previous_role', v_current_role,
      'new_role', p_role
    )
  );
end;
$$;

create or replace function public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_target_role public.workspace_role;
  v_admin_count bigint;
begin
  if v_user_id is null then
    raise exception 'authentication required';
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

  select m.role
  into v_target_role
  from public.memberships m
  where m.workspace_id = p_workspace_id
    and m.user_id = p_user_id;
  if not found then
    raise exception 'workspace membership not found';
  end if;

  if v_target_role = 'admin' then
    select count(*)
    into v_admin_count
    from public.memberships m
    where m.workspace_id = p_workspace_id
      and m.role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'workspace must retain an admin';
    end if;
  end if;

  delete from public.memberships
  where workspace_id = p_workspace_id
    and user_id = p_user_id;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    p_workspace_id,
    v_user_id,
    'membership.removed',
    'membership',
    p_user_id
  );
end;
$$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_current_role public.workspace_role;
  v_admin_count bigint;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  perform 1
  from public.workspaces w
  where w.id = p_workspace_id
  for update;
  if not found then
    raise exception 'workspace not found';
  end if;

  select m.role
  into v_current_role
  from public.memberships m
  where m.workspace_id = p_workspace_id
    and m.user_id = v_user_id;
  if not found then
    raise exception 'workspace membership required';
  end if;

  if v_current_role = 'admin' then
    select count(*)
    into v_admin_count
    from public.memberships m
    where m.workspace_id = p_workspace_id
      and m.role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'workspace must retain an admin';
    end if;
  end if;

  delete from public.memberships
  where workspace_id = p_workspace_id
    and user_id = v_user_id;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    p_workspace_id,
    v_user_id,
    'membership.left',
    'membership',
    v_user_id
  );
end;
$$;

revoke all on function public.create_workspace(text) from public, anon, authenticated;
revoke all on function public.rename_workspace(uuid, text) from public, anon, authenticated;
revoke all on function public.set_workspace_member_role(
  uuid,
  uuid,
  public.workspace_role
) from public, anon, authenticated;
revoke all on function public.remove_workspace_member(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.leave_workspace(uuid)
  from public, anon, authenticated;

grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.rename_workspace(uuid, text) to authenticated;
grant execute on function public.set_workspace_member_role(
  uuid,
  uuid,
  public.workspace_role
) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid)
  to authenticated;
grant execute on function public.leave_workspace(uuid) to authenticated;
