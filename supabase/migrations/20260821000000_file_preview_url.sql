-- Resolve an upload's storage path only after checking the current member can read the file.
-- The browser uses the returned path solely with the existing documents_select_member
-- Storage policy to create a short-lived signed URL.
create or replace function public.get_file_storage_path(p_file_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_storage_path text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if p_file_id is null then
    raise exception 'file is required';
  end if;

  select v.storage_path
  into v_storage_path
  from public.files f
  join public.file_versions v
    on v.id = f.current_version_id
    and v.file_id = f.id
    and v.workspace_id = f.workspace_id
  where f.id = p_file_id
    and f.deleted_at is null
    and private.is_workspace_member(f.workspace_id);

  if v_storage_path is null then
    raise exception 'file preview is unavailable';
  end if;

  return v_storage_path;
end;
$$;

revoke all on function public.get_file_storage_path(uuid)
  from public, anon, authenticated;
grant execute on function public.get_file_storage_path(uuid)
  to authenticated;

-- A signed URL request must never authorize an obsolete version after a new
-- version becomes current. Replace the baseline policy in this forward
-- migration so old clients and new clients share the same current-version
-- boundary; already-issued URLs retain their normal expiry semantics.
drop policy if exists documents_select_member on storage.objects;

create policy documents_select_member on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and private.is_workspace_member(
    private.storage_workspace_id(name)
  )
  and exists (
    select 1
    from public.file_versions v
    join public.files f on f.id = v.file_id
    where v.storage_path = name
      and v.workspace_id = private.storage_workspace_id(name)
      and f.current_version_id = v.id
      and f.source_type = 'upload'
      and f.deleted_at is null
  )
);
