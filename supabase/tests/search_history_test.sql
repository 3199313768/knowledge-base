-- UNRUN until a dedicated disposable database and ordinary JWT actors are
-- explicitly authorized. Static SQL review is not runtime RLS evidence.
begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

select extensions.has_table('public', 'search_history');

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'search_history'
      and column_name in ('user_id', 'workspace_id', 'created_at', 'updated_at')
      and is_nullable = 'NO'
    group by table_schema, table_name
    having count(*) = 4
  ),
  'search history has required identity and timestamp fields'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'search_history'
      and column_name = 'normalized_query'
      and is_nullable = 'NO'
  )
  and private.normalize_search_history_query(E'\t Foo\n') = 'foo'
  and private.normalize_search_history_query(E'\n\t  \r') = ''
  and private.normalize_search_history_query('FOO')
    = private.normalize_search_history_query(E'foo\t')
  and char_length(private.normalize_search_history_query(repeat('x', 501))) = 501
  and private.normalize_search_history_query(null) is null,
  'canonicalization handles tab/newline trimming, whitespace-only, case dedupe, 501 characters, and null'
);

select extensions.ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'search_history'
      and indexname = 'search_history_user_workspace_updated_idx'
  ),
  'search history has a user/workspace recency index'
);

select extensions.ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'search_history'
      and indexname = 'search_history_workspace_updated_idx'
  ),
  'search history has a workspace recency index'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.search_history'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%user_id%workspace_id%normalized_query%'
  ),
  'search history deduplicates a query per user and workspace'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.search_history'::regclass),
  'search history has RLS enabled'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.search_history', 'SELECT'),
  'anon cannot directly read search history'
);

select extensions.ok(
  has_table_privilege('authenticated', 'public.search_history', 'SELECT')
  and has_table_privilege('authenticated', 'public.search_history', 'DELETE')
  and not has_table_privilege('authenticated', 'public.search_history', 'INSERT')
  and not has_table_privilege('authenticated', 'public.search_history', 'UPDATE'),
  'authenticated can list and clear but cannot directly insert or update rows'
);

select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'search_history'
      and policyname = 'search_history_select_own_workspace'
      and roles = array['authenticated']::name[]
      and lower(coalesce(qual, '')) like '%user_id%auth.uid%'
      and lower(coalesce(qual, '')) like '%is_workspace_member%'
  ),
  'select policy is authenticated-only and requires own user plus membership'
);

select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'search_history'
      and policyname = 'search_history_insert_own_workspace'
      and roles = array['authenticated']::name[]
      and lower(coalesce(with_check, '')) like '%user_id%auth.uid%'
      and lower(coalesce(with_check, '')) like '%is_workspace_member%'
  ),
  'insert policy is authenticated-only and prevents forged users or non-members'
);

select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'search_history'
      and policyname = 'search_history_update_own_workspace'
      and roles = array['authenticated']::name[]
      and lower(coalesce(qual, '')) like '%user_id%auth.uid%'
      and lower(coalesce(with_check, '')) like '%user_id%auth.uid%'
      and lower(coalesce(with_check, '')) like '%is_workspace_member%'
  ),
  'update policy is authenticated-only and preserves own member boundary'
);

select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'search_history'
      and policyname = 'search_history_delete_own_workspace'
      and roles = array['authenticated']::name[]
      and lower(coalesce(qual, '')) like '%user_id%auth.uid%'
      and lower(coalesce(qual, '')) like '%is_workspace_member%'
  ),
  'delete policy is authenticated-only and prevents cross-user/workspace clearing'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'record_search_history'
      and p.proargtypes = array['uuid'::regtype, 'text'::regtype]::oidvector
      and p.prosecdef
      and coalesce(p.proconfig, array[]::text[]) @> array['search_path=']
  ),
  'recording RPC exists with a fixed empty search_path definer boundary'
);

select extensions.ok(
  exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'record_search_history'
      and grantee = 'authenticated'
      and privilege_type = 'EXECUTE'
  )
  and not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'record_search_history'
      and grantee in ('anon', 'PUBLIC')
      and privilege_type = 'EXECUTE'
  ),
  'recording RPC is authenticated-only'
);

select extensions.ok(
  exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.search_history'::regclass
      and t.tgname in ('search_history_protect_identity', 'search_history_touch_updated_at')
      and not t.tgenabled = 'D'
    group by t.tgrelid
    having count(*) = 2
  ),
  'search history preserves ownership and refreshes recency on conflict updates'
);

-- Ordinary JWT actors must still prove that 21 distinct records retain only
-- the newest 20, plus same-user ownership and cross-workspace isolation.
select extensions.skip(1, 'ordinary-JWT 21-record cap and isolation gate is UNRUN');
select * from extensions.finish();
rollback;
