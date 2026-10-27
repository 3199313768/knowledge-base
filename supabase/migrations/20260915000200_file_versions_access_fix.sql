-- Reassert the intended authenticated read/execute contract for file upload.
grant select on table public.file_versions to authenticated;
grant execute on function public.prepare_file_upload(uuid, text, text, bigint, text)
  to authenticated;
grant execute on function public.mark_upload_complete(uuid) to authenticated;

drop policy if exists file_versions_select_member on public.file_versions;
create policy file_versions_select_member on public.file_versions
for select to authenticated
using (
  private.is_workspace_member(workspace_id)
  and exists (
    select 1
    from public.files f
    where f.id = file_id
      and f.workspace_id = workspace_id
      and f.deleted_at is null
  )
);
