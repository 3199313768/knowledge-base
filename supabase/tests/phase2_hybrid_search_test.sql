-- UNRUN until a dedicated disposable database and ordinary JWT actors are
-- explicitly authorized. Static SQL review is not runtime evidence.
begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

select extensions.ok(
  exists (select 1 from pg_catalog.pg_proc where proname = 'search_workspace_files'),
  'the user-scoped hybrid search RPC exists'
);
select extensions.ok(
  exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'search_workspace_files' and p.prosecdef = false),
  'the search RPC is security invoker'
);
select extensions.ok(
  exists (select 1 from pg_catalog.pg_indexes where indexname = 'content_chunks_search_tokens_gin_idx'),
  'lexical tokens have a GIN index'
);
select extensions.ok(
  exists (select 1 from pg_catalog.pg_indexes where indexname = 'files_active_display_name_trgm_idx'),
  'active filenames have a trigram index'
);
select extensions.ok(
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'search_workspace_files' and grantee in ('anon', 'PUBLIC')
  ),
  'anonymous callers do not receive the search RPC'
);
-- The remaining assertions require ordinary JWT sessions and synthetic files;
-- they are intentionally skipped here rather than represented as false passes.
select extensions.skip(3, 'ordinary-JWT workspace, current-version/filter, and snippet/location gates are UNRUN');
select * from extensions.finish();
rollback;
