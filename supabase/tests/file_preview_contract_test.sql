-- UNRUN until a dedicated disposable database and ordinary JWT actors are
-- explicitly authorized. Static SQL review is not runtime RLS evidence.
begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_file_storage_path'
      and p.proargtypes = array['uuid'::regtype]::oidvector
  ),
  'protected file storage path RPC exists'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'get_file_storage_path'
      and grantee = 'authenticated'
      and privilege_type = 'EXECUTE'
  )
  and not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'get_file_storage_path'
      and grantee in ('anon', 'PUBLIC')
      and privilege_type = 'EXECUTE'
  ),
  'preview RPC is authenticated-only'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'documents_select_member'
      and lower(coalesce(p.qual, '')) like '%current_version_id%'
  ),
  'documents select policy is restricted to current file versions'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'documents_select_member'
      and lower(coalesce(p.qual, '')) like '%deleted_at%'
  ),
  'documents select policy excludes deleted files'
);

-- Ordinary JWT actors are required to prove same-workspace access and stale
-- version rejection; those checks remain explicitly UNRUN in this environment.
select extensions.skip(1, 'ordinary-JWT current-version and workspace-isolation gate is UNRUN');
select * from extensions.finish();
rollback;
