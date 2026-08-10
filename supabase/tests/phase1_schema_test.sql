begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

select extensions.has_table('public', 'workspaces');
select extensions.has_table('public', 'memberships');
select extensions.has_table('public', 'workspace_invitations');
select extensions.has_table('public', 'files');
select extensions.has_table('public', 'file_versions');
select extensions.has_table('public', 'processing_jobs');
select extensions.has_table('public', 'content_chunks');
select extensions.has_table('public', 'devices');
select extensions.has_table('public', 'audit_events');

do $$
declare
  source_shape_definition text;
begin
  select lower(pg_get_constraintdef(c.oid))
  into source_shape_definition
  from pg_constraint c
  where c.conrelid = 'public.file_versions'::regclass
    and c.contype = 'c'
    and lower(pg_get_constraintdef(c.oid)) like '%storage_path is not null%';

  if source_shape_definition is null
    or source_shape_definition not like '%size_bytes is not null%'
  then
    raise exception 'file_versions upload source must require non-null size_bytes';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.memberships'::regclass
      and c.confrelid = 'auth.users'::regclass
      and c.contype = 'f'
      and c.conkey = array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.memberships'::regclass
            and attname = 'user_id'
        )
      ]::smallint[]
      and c.confkey = array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'auth.users'::regclass
            and attname = 'id'
        )
      ]::smallint[]
      and c.confdeltype = 'r'
  ) then
    raise exception 'memberships.user_id must restrict auth user deletion';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conname = 'files_current_version_fk'
      and c.conrelid = 'public.files'::regclass
      and c.confrelid = 'public.file_versions'::regclass
      and c.conkey = array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.files'::regclass
            and attname = 'current_version_id'
        ),
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.files'::regclass
            and attname = 'id'
        ),
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.files'::regclass
            and attname = 'workspace_id'
        )
      ]::smallint[]
      and c.confkey = array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.file_versions'::regclass
            and attname = 'id'
        ),
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.file_versions'::regclass
            and attname = 'file_id'
        ),
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.file_versions'::regclass
            and attname = 'workspace_id'
        )
      ]::smallint[]
      and c.confdeltype = 'n'
      and lower(pg_get_constraintdef(c.oid))
        like '%on delete set null (current_version_id)%'
      and c.condeferrable
      and c.condeferred
  ) then
    raise exception 'files.current_version_id must reference its own file and workspace';
  end if;
end;
$$;

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.workspaces'::regclass),
  'workspaces has RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.files'::regclass),
  'files has RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.content_chunks'::regclass),
  'content_chunks has RLS enabled'
);
select extensions.is(
  (select public from storage.buckets where id = 'documents'),
  false,
  'documents bucket is private'
);
select extensions.is(
  (select file_size_limit from storage.buckets where id = 'documents'),
  100000000::bigint,
  'documents bucket uses the frozen decimal size limit'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.spike_chunks', 'SELECT'),
  'Phase 0 spike data is not readable by anon'
);

select * from extensions.finish();
rollback;
