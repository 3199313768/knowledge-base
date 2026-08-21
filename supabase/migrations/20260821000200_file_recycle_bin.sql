-- Recycle bin contract. Permanent deletion is staged: a trusted worker must
-- remove Storage objects before final database deletion; the browser never gets
-- a false "deleted" result when cleanup has not completed.
alter table public.files add column if not exists purge_at timestamptz;
create index if not exists files_recycle_bin_idx on public.files(workspace_id, purge_at)
  where deleted_at is not null;

create or replace function public.soft_delete_file(p_file_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_workspace uuid; v_uploader uuid; v_deleted timestamptz;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select workspace_id, uploader_id, deleted_at into v_workspace, v_uploader, v_deleted
    from public.files where id = p_file_id for update;
  if not found then raise exception 'file not found'; end if;
  if v_deleted is not null then raise exception 'file has already been deleted'; end if;
  if not private.is_workspace_member(v_workspace) then raise exception 'workspace membership required'; end if;
  if v_uploader <> v_actor and not private.is_workspace_admin(v_workspace) then raise exception 'file management required'; end if;
  update public.files set deleted_at = now(), deleted_by = v_actor, purge_at = now() + interval '30 days', updated_at = now()
    where id = p_file_id;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (v_workspace, v_actor, 'file.deleted', 'file', p_file_id);
end; $$;

create or replace function public.list_deleted_files(p_workspace_id uuid)
returns table(file_id uuid, workspace_id uuid, display_name text, deleted_at timestamptz, purge_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select f.id, f.workspace_id, f.display_name, f.deleted_at, f.purge_at
  from public.files f
  where f.workspace_id = p_workspace_id
    and f.deleted_at is not null
    and private.is_workspace_member(f.workspace_id)
  order by f.deleted_at desc, f.id;
$$;

create or replace function public.restore_file(p_file_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_actor uuid := auth.uid(); v_deleted timestamptz;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select workspace_id, deleted_at into v_workspace, v_deleted from public.files where id = p_file_id for update;
  if not found then raise exception 'file not found'; end if;
  if not private.is_workspace_member(v_workspace) then raise exception 'workspace membership required'; end if;
  if v_deleted is null then raise exception 'file is not deleted'; end if;
  update public.files set deleted_at = null, deleted_by = null, purge_at = null, updated_at = now() where id = p_file_id;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
  values (v_workspace, v_actor, 'file.restored', 'file', p_file_id);
end; $$;

create or replace function public.permanently_delete_file(p_file_id uuid)
returns table(cleanup_job_id uuid, status text)
language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_actor uuid := auth.uid(); v_deleted timestamptz; v_job uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select workspace_id, deleted_at into v_workspace, v_deleted from public.files where id = p_file_id for update;
  if not found then raise exception 'file not found'; end if;
  if v_deleted is null then raise exception 'file is not deleted'; end if;
  if not private.is_workspace_member(v_workspace) then raise exception 'workspace membership required'; end if;
  insert into public.processing_jobs(version_id, stage, status)
    select v.id, 'cleanup', 'pending' from public.file_versions v where v.file_id = p_file_id
    on conflict (version_id, stage) do nothing;
  select gen_random_uuid() into v_job;
  insert into public.audit_events(workspace_id, actor_id, action, target_type, target_id)
    values (v_workspace, v_actor, 'file.permanent_delete_requested', 'file', p_file_id);
  cleanup_job_id := v_job; status := 'cleanup_pending'; return next;
end; $$;

revoke all on function public.list_deleted_files(uuid), public.restore_file(uuid), public.permanently_delete_file(uuid) from public, anon;
grant execute on function public.list_deleted_files(uuid), public.restore_file(uuid), public.permanently_delete_file(uuid) to authenticated;
