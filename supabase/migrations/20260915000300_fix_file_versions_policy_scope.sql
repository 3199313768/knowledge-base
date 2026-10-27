drop policy if exists file_versions_select_member on public.file_versions;
create policy file_versions_select_member on public.file_versions
for select to authenticated
using (
  private.is_workspace_member(file_versions.workspace_id)
  and exists (
    select 1
    from public.files f
    where f.id = file_versions.file_id
      and f.workspace_id = file_versions.workspace_id
      and f.deleted_at is null
  )
);
