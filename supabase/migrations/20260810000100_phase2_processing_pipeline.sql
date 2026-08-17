-- PostgreSQL DDL is transactional: if any later statement fails, rollback
-- restores this named Phase 1 freeze trigger together with all schema/data edits.
lock table public.content_chunks in access exclusive mode;
alter table public.content_chunks
  disable trigger content_chunks_enforce_processing_version;

alter table public.content_chunks
  add column chunk_index integer;

with ranked_chunks as (
  select
    c.id,
    pg_catalog.row_number() over (
      partition by c.version_id
      order by c.created_at, c.id
    ) - 1 as chunk_index
  from public.content_chunks c
)
update public.content_chunks c
set chunk_index = ranked_chunks.chunk_index
from ranked_chunks
where ranked_chunks.id = c.id;

alter table public.content_chunks
  alter column chunk_index set not null,
  add column search_tokens text[] not null default '{}'::text[],
  add constraint content_chunks_version_chunk_index_unique
    unique (version_id, chunk_index),
  add constraint content_chunks_chunk_index_nonnegative
    check (chunk_index >= 0);

create index content_chunks_search_tokens_gin_idx
  on public.content_chunks using gin (search_tokens);

alter table public.processing_jobs
  add column worker_id text,
  add column lease_expires_at timestamptz,
  add constraint processing_jobs_worker_id_bounded
    check (
      worker_id is null
      or pg_catalog.char_length(pg_catalog.btrim(worker_id)) between 1 and 200
    );

create index processing_jobs_claimable_idx
  on public.processing_jobs (
    available_at,
    lease_expires_at,
    created_at,
    id
  )
  where status in ('pending', 'running') and attempts < 3;

-- Phase 1 running rows predate leases. Move retryable active/cleanup work
-- through the allowed running -> failed -> pending transitions so a Phase 2
-- worker can reclaim it with a real owner and lease.
update public.processing_jobs j
set status = 'failed',
    error_code = 'worker_restart',
    worker_id = 'phase2-migration-recovery',
    lease_expires_at = null,
    updated_at = pg_catalog.now()
where j.status = 'running'
  and j.attempts < 3
  and j.stage in ('validate', 'extract', 'chunk', 'embed', 'finalize', 'cleanup');

update public.processing_jobs j
set status = 'pending',
    error_code = null,
    worker_id = null,
    available_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
where j.status = 'failed'
  and j.error_code = 'worker_restart'
  and j.worker_id = 'phase2-migration-recovery'
  and j.attempts < 3
  and j.stage in ('validate', 'extract', 'chunk', 'embed', 'finalize', 'cleanup');

-- Pending OCR is moved through the Phase 1-legal pending -> running edge so
-- the terminalization below can use the legal running -> failed edge.
update public.processing_jobs j
set status = 'running',
    worker_id = 'phase2-migration-ocr-terminal',
    lease_expires_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
where j.status = 'pending'
  and j.stage = 'ocr';

-- Exhausted active jobs and all legacy OCR jobs cannot be reclaimed by the
-- Phase 2 allowlist. Terminalize their processing versions atomically.
with terminalized_jobs as (
  update public.processing_jobs j
  set status = 'failed',
      error_code = case
        when j.stage = 'ocr' then 'ocr_required'
        else 'worker_timeout'
      end,
      worker_id = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where j.status = 'running'
    and j.stage <> 'cleanup'
    and (j.attempts >= 3 or j.stage = 'ocr')
  returning j.version_id, j.error_code
), terminal_versions as (
  select distinct on (terminalized_jobs.version_id)
    terminalized_jobs.version_id,
    terminalized_jobs.error_code
  from terminalized_jobs
  order by terminalized_jobs.version_id, terminalized_jobs.error_code
), failed_versions as (
  update public.file_versions v
  set status = 'failed',
      error_code = terminal_versions.error_code
  from terminal_versions
  where v.id = terminal_versions.version_id
    and v.status in ('pending_processing', 'processing')
  returning v.id, v.workspace_id, v.error_code
)
insert into public.audit_events (
  workspace_id,
  actor_id,
  action,
  target_type,
  target_id,
  metadata
)
select
  failed_versions.workspace_id,
  null,
  'file_version.finalized',
  'file_version',
  failed_versions.id,
  pg_catalog.jsonb_build_object(
    'status', 'failed',
    'error_code', failed_versions.error_code
  )
from failed_versions;

-- Cleanup is file-deletion maintenance. Exhaustion never changes or falsely
-- finalizes the file version it is cleaning.
with failed_cleanup_jobs as (
  update public.processing_jobs j
  set status = 'failed',
      error_code = 'worker_timeout',
      worker_id = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where j.status = 'running'
    and j.stage = 'cleanup'
    and j.attempts >= 3
  returning j.version_id
)
insert into public.audit_events (
  workspace_id,
  actor_id,
  action,
  target_type,
  target_id,
  metadata
)
select
  v.workspace_id,
  null,
  'file.cleanup_failed',
  'file_version',
  v.id,
  pg_catalog.jsonb_build_object('error_code', 'worker_timeout')
from public.file_versions v
join failed_cleanup_jobs on failed_cleanup_jobs.version_id = v.id;

create or replace function private.is_positive_json_integer(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_value) = 'number'
    and p_value #>> '{}' ~ '^[1-9][0-9]*$';
$$;

create or replace function private.is_valid_processing_source_location(
  p_location jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_block_start integer;
  v_block_end integer;
  v_row_start integer;
  v_row_end integer;
begin
  if p_location is null
    or pg_catalog.jsonb_typeof(p_location) <> 'object'
    or not (p_location ?& array['schemaVersion', 'kind', 'label'])
    or p_location -> 'schemaVersion' is distinct from '1'::jsonb
    or pg_catalog.jsonb_typeof(p_location -> 'kind') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_location -> 'label') is distinct from 'string'
    or coalesce(p_location ->> 'label', '') !~ '[^[:space:]]'
    or coalesce(p_location ->> 'kind', '') not in ('page', 'document')
  then
    return false;
  end if;

  if p_location ->> 'kind' = 'page' then
    return p_location ?& array['schemaVersion', 'kind', 'page', 'label']
      and coalesce(
      private.is_positive_json_integer(p_location -> 'page'),
      false
    )
      and p_location - array[
        'schemaVersion',
        'kind',
        'page',
        'label'
      ] = '{}'::jsonb;
  end if;

  if not (
      p_location ?& array[
        'schemaVersion',
        'kind',
        'blockType',
        'blockStart',
        'blockEnd',
        'label'
      ]
    )
    or pg_catalog.jsonb_typeof(p_location -> 'blockType')
      is distinct from 'string'
    or coalesce(p_location ->> 'blockType', '') not in ('paragraph', 'table')
    or not coalesce(
      private.is_positive_json_integer(p_location -> 'blockStart'),
      false
    )
    or not coalesce(
      private.is_positive_json_integer(p_location -> 'blockEnd'),
      false
    )
  then
    return false;
  end if;

  if p_location ? 'headingPath' then
    if pg_catalog.jsonb_typeof(p_location -> 'headingPath')
      is distinct from 'array'
    then
      return false;
    end if;
    if pg_catalog.jsonb_array_length(p_location -> 'headingPath') = 0 then
      return false;
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        p_location -> 'headingPath'
      ) as heading(value)
      where pg_catalog.jsonb_typeof(heading.value) <> 'string'
        or coalesce(heading.value #>> '{}', '') !~ '[^[:space:]]'
    ) then
      return false;
    end if;
  end if;

  v_block_start := (p_location ->> 'blockStart')::integer;
  v_block_end := (p_location ->> 'blockEnd')::integer;
  if v_block_start > v_block_end then
    return false;
  end if;

  if p_location ->> 'blockType' = 'paragraph' then
    return not (p_location ?| array['tableIndex', 'rowStart', 'rowEnd'])
      and p_location - array[
        'schemaVersion',
        'kind',
        'blockType',
        'blockStart',
        'blockEnd',
        'headingPath',
        'label'
      ] = '{}'::jsonb;
  end if;

  if not coalesce(
      private.is_positive_json_integer(p_location -> 'tableIndex'),
      false
    )
    or not coalesce(
      private.is_positive_json_integer(p_location -> 'rowStart'),
      false
    )
    or not coalesce(
      private.is_positive_json_integer(p_location -> 'rowEnd'),
      false
    )
  then
    return false;
  end if;

  if not (p_location ?& array['tableIndex', 'rowStart', 'rowEnd']) then
    return false;
  end if;

  v_row_start := (p_location ->> 'rowStart')::integer;
  v_row_end := (p_location ->> 'rowEnd')::integer;
  return v_row_start <= v_row_end
    and p_location - array[
      'schemaVersion',
      'kind',
      'blockType',
      'blockStart',
      'blockEnd',
      'headingPath',
      'tableIndex',
      'rowStart',
      'rowEnd',
      'label'
    ] = '{}'::jsonb;
exception
  when numeric_value_out_of_range or invalid_text_representation then
    return false;
end;
$$;

revoke all on function private.is_positive_json_integer(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_valid_processing_source_location(jsonb)
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.is_valid_processing_source_location(jsonb)
  to service_role;

-- Phase 1 accepted page-only locations such as {"page": 1}. Upgrade only
-- that unambiguous legacy shape; do not invent document/table coordinates.
update public.content_chunks c
set source_location = pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'kind', 'page',
  'page', (c.source_location ->> 'page')::integer,
  'label', case
    when pg_catalog.jsonb_typeof(c.source_location -> 'label') = 'string'
      and (c.source_location ->> 'label') ~ '[^[:space:]]'
    then c.source_location ->> 'label'
    else 'Page ' || (c.source_location ->> 'page')
  end
)
where pg_catalog.jsonb_typeof(c.source_location) = 'object'
  and not (c.source_location ? 'schemaVersion')
  and private.is_positive_json_integer(c.source_location -> 'page')
  and c.source_location - array['page', 'label'] = '{}'::jsonb
  and (
    not (c.source_location ? 'label')
    or pg_catalog.jsonb_typeof(c.source_location -> 'label') = 'string'
  );

alter table public.content_chunks
  add constraint content_chunks_source_location_valid
    check (private.is_valid_processing_source_location(source_location));

alter table public.content_chunks
  enable trigger content_chunks_enforce_processing_version;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.content_chunks'::pg_catalog.regclass
      and t.tgname = 'content_chunks_enforce_processing_version'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ) then
    raise exception 'content chunk freeze trigger was not restored';
  end if;
end;
$$;

create table public.processing_warnings (
  id uuid primary key default extensions.gen_random_uuid(),
  version_id uuid not null
    references public.file_versions(id) on delete cascade,
  stage public.processing_stage not null,
  code text not null,
  source_location jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  constraint processing_warnings_code_bounded check (
    pg_catalog.char_length(code) between 1 and 100
    and code ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
  ),
  constraint processing_warnings_source_location_valid check (
    source_location is null
    or private.is_valid_processing_source_location(source_location)
  )
);

create index processing_warnings_version_idx
  on public.processing_warnings (version_id, created_at, id);

alter table public.processing_warnings enable row level security;
revoke all on public.processing_warnings from public, anon, authenticated;
grant select on public.processing_warnings to authenticated;
revoke update, delete, truncate on public.processing_warnings from service_role;
grant select, insert on public.processing_warnings to service_role;

create policy processing_warnings_select_member
on public.processing_warnings
for select
to authenticated
using (
  exists (
    select 1
    from public.file_versions v
    join public.files f
      on f.id = v.file_id
      and f.workspace_id = v.workspace_id
    where v.id = processing_warnings.version_id
      and f.deleted_at is null
      and private.is_workspace_member(v.workspace_id)
  )
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'processing-artifacts',
  'processing-artifacts',
  false,
  100000000,
  array['application/gzip']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

revoke execute on function public.claim_processing_job()
  from service_role;
revoke execute on function public.complete_processing_job(uuid, boolean, text)
  from service_role;
revoke execute on function public.finalize_file_version(
  uuid,
  public.file_version_status,
  text
) from service_role;

create or replace function private.normalize_processing_worker_id(
  p_worker_id text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_worker_id text := pg_catalog.btrim(coalesce(p_worker_id, ''));
begin
  if pg_catalog.char_length(v_worker_id) not between 1 and 200 then
    raise exception 'worker id must contain 1 to 200 characters';
  end if;
  return v_worker_id;
end;
$$;

create or replace function private.validate_processing_lease_seconds(
  p_lease_seconds integer
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'lease seconds must be between 30 and 900';
  end if;
  return p_lease_seconds;
end;
$$;

create or replace function private.next_active_processing_stage(
  p_stage public.processing_stage
)
returns public.processing_stage
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'validate' then 'extract'::public.processing_stage
    when 'extract' then 'chunk'::public.processing_stage
    when 'chunk' then 'embed'::public.processing_stage
    when 'embed' then 'finalize'::public.processing_stage
    else null::public.processing_stage
  end;
$$;

create or replace function private.lock_owned_processing_lease(
  p_job_id uuid,
  p_worker_id text
)
returns table (
  version_id uuid,
  file_id uuid,
  workspace_id uuid,
  stage public.processing_stage,
  version_status public.file_version_status,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_id text := private.normalize_processing_worker_id(p_worker_id);
  v_version_id uuid;
  v_file_id uuid;
  v_workspace_id uuid;
  v_stage public.processing_stage;
  v_version_status public.file_version_status;
  v_deleted_at timestamptz;
begin
  select j.version_id, v.file_id, v.workspace_id
  into v_version_id, v_file_id, v_workspace_id
  from public.processing_jobs j
  join public.file_versions v on v.id = j.version_id
  where j.id = p_job_id;
  if not found then
    raise exception 'processing job not found';
  end if;

  perform 1
  from public.files f
  where f.id = v_file_id
    and f.workspace_id = v_workspace_id
  for update;
  if not found then
    raise exception 'file not found';
  end if;

  perform 1
  from public.file_versions v
  where v.id = v_version_id
    and v.file_id = v_file_id
    and v.workspace_id = v_workspace_id
  for update;
  if not found then
    raise exception 'file version not found';
  end if;

  select j.stage, v.status, f.deleted_at
  into v_stage, v_version_status, v_deleted_at
  from public.processing_jobs j
  join public.file_versions v on v.id = j.version_id
  join public.files f
    on f.id = v.file_id
    and f.workspace_id = v.workspace_id
  where j.id = p_job_id
    and j.version_id = v_version_id
    and j.status = 'running'
    and j.worker_id = v_worker_id
    and j.lease_expires_at > pg_catalog.now()
  for update of j;
  if not found then
    raise exception 'active processing lease not owned by worker';
  end if;

  if v_stage = 'cleanup' then
    if v_deleted_at is null then
      raise exception 'cleanup requires a deleted file';
    end if;
  elsif v_stage in ('validate', 'extract', 'chunk', 'embed', 'finalize') then
    if v_deleted_at is not null then
      raise exception 'active processing stage cannot mutate a deleted file';
    end if;
    if v_version_status <> 'processing' then
      raise exception 'file version is not processing';
    end if;
  else
    raise exception 'processing stage is not active in Phase 2';
  end if;

  return query
  select
    v_version_id,
    v_file_id,
    v_workspace_id,
    v_stage,
    v_version_status,
    v_deleted_at;
end;
$$;

revoke all on function private.normalize_processing_worker_id(text)
  from public, anon, authenticated;
revoke all on function private.validate_processing_lease_seconds(integer)
  from public, anon, authenticated;
revoke all on function private.next_active_processing_stage(
  public.processing_stage
) from public, anon, authenticated;
revoke all on function private.lock_owned_processing_lease(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.claim_processing_job(
  p_worker_id text,
  p_lease_seconds integer
)
returns table (
  job_id uuid,
  version_id uuid,
  file_id uuid,
  workspace_id uuid,
  stage public.processing_stage,
  storage_path text,
  original_url text,
  mime_type text,
  checksum text,
  size_bytes bigint,
  attempt integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_id text := private.normalize_processing_worker_id(p_worker_id);
  v_lease_seconds integer := private.validate_processing_lease_seconds(
    p_lease_seconds
  );
  v_job_id uuid;
  v_version_id uuid;
  v_file_id uuid;
  v_workspace_id uuid;
  v_stage public.processing_stage;
  v_storage_path text;
  v_original_url text;
  v_mime_type text;
  v_checksum text;
  v_size_bytes bigint;
  v_attempt integer;
  v_lease_expires_at timestamptz;
  v_version_status public.file_version_status;
  v_exhausted_job_id uuid;
  v_exhausted_version_id uuid;
  v_exhausted_file_id uuid;
  v_exhausted_stage public.processing_stage;
  v_exhausted_workspace_id uuid;
  v_exhausted_deleted_at timestamptz;
  v_exhausted_version_status public.file_version_status;
begin
  select j.id, j.version_id, v.file_id, j.stage, v.workspace_id
  into
    v_exhausted_job_id,
    v_exhausted_version_id,
    v_exhausted_file_id,
    v_exhausted_stage,
    v_exhausted_workspace_id
  from public.processing_jobs j
  join public.file_versions v on v.id = j.version_id
  join public.files f
    on f.id = v.file_id
    and f.workspace_id = v.workspace_id
  where j.status = 'running'
    and j.attempts >= 3
    and j.lease_expires_at <= pg_catalog.now()
    and (
      j.stage in ('validate', 'extract', 'chunk', 'embed', 'finalize')
      or j.stage = 'cleanup'
    )
  order by j.lease_expires_at, j.id
  limit 1;

  if found then
    perform 1
    from public.files f
    where f.id = v_exhausted_file_id
      and f.workspace_id = v_exhausted_workspace_id
    for update;

    perform 1
    from public.file_versions v
    where v.id = v_exhausted_version_id
      and v.file_id = v_exhausted_file_id
      and v.workspace_id = v_exhausted_workspace_id
    for update;

    select f.deleted_at, v.status
    into v_exhausted_deleted_at, v_exhausted_version_status
    from public.processing_jobs j
    join public.file_versions v on v.id = j.version_id
    join public.files f
      on f.id = v.file_id
      and f.workspace_id = v.workspace_id
    where j.id = v_exhausted_job_id
      and j.status = 'running'
      and j.attempts >= 3
      and j.lease_expires_at <= pg_catalog.now()
    for update of j;

    if found then
      update public.processing_jobs j
      set status = 'failed',
          error_code = 'worker_timeout',
          worker_id = null,
          lease_expires_at = null,
          updated_at = pg_catalog.now()
      where j.id = v_exhausted_job_id;
    end if;

    if found
      and v_exhausted_stage in (
        'validate',
        'extract',
        'chunk',
        'embed',
        'finalize'
      )
      and v_exhausted_deleted_at is null
      and v_exhausted_version_status = 'processing'
    then
      update public.file_versions v
      set status = 'failed',
          error_code = 'worker_timeout'
      where v.id = v_exhausted_version_id
        and v.status = 'processing';

      insert into public.audit_events (
        workspace_id,
        actor_id,
        action,
        target_type,
        target_id,
        metadata
      )
      values (
        v_exhausted_workspace_id,
        null,
        'file_version.finalized',
        'file_version',
        v_exhausted_version_id,
        pg_catalog.jsonb_build_object(
          'status', 'failed',
          'error_code', 'worker_timeout'
        )
      );
    elsif found
      and v_exhausted_stage = 'cleanup'
      and v_exhausted_deleted_at is not null
    then
      insert into public.audit_events (
        workspace_id,
        actor_id,
        action,
        target_type,
        target_id,
        metadata
      )
      values (
        v_exhausted_workspace_id,
        null,
        'file.cleanup_failed',
        'file_version',
        v_exhausted_version_id,
        pg_catalog.jsonb_build_object('error_code', 'worker_timeout')
      );
    end if;
  end if;

  loop
    select j.id, j.version_id, v.file_id, v.workspace_id
    into v_job_id, v_version_id, v_file_id, v_workspace_id
    from public.processing_jobs j
    join public.file_versions v on v.id = j.version_id
    join public.files f
      on f.id = v.file_id
      and f.workspace_id = v.workspace_id
    where j.attempts < 3
      and (
        (j.status = 'pending' and j.available_at <= pg_catalog.now())
        or (
          j.status = 'running'
          and j.lease_expires_at <= pg_catalog.now()
        )
      )
      and (
        (
          j.stage in ('validate', 'extract', 'chunk', 'embed', 'finalize')
          and f.deleted_at is null
          and v.status in ('pending_processing', 'processing')
        )
        or (j.stage = 'cleanup' and f.deleted_at is not null)
      )
    order by
      case
        when j.status = 'running' then j.lease_expires_at
        else j.available_at
      end,
      j.created_at,
      j.id
    limit 1;

    if not found then
      return;
    end if;

    perform 1
    from public.files f
    where f.id = v_file_id
      and f.workspace_id = v_workspace_id
    for update;
    if not found then
      continue;
    end if;

    perform 1
    from public.file_versions v
    where v.id = v_version_id
      and v.file_id = v_file_id
      and v.workspace_id = v_workspace_id
    for update;
    if not found then
      continue;
    end if;

    select
      j.stage,
      v.storage_path,
      v.original_url,
      v.mime_type,
      v.checksum,
      v.size_bytes,
      v.status
    into
      v_stage,
      v_storage_path,
      v_original_url,
      v_mime_type,
      v_checksum,
      v_size_bytes,
      v_version_status
    from public.processing_jobs j
    join public.file_versions v on v.id = j.version_id
    join public.files f
      on f.id = v.file_id
      and f.workspace_id = v.workspace_id
    where j.id = v_job_id
      and j.version_id = v_version_id
      and j.attempts < 3
      and (
        (j.status = 'pending' and j.available_at <= pg_catalog.now())
        or (
          j.status = 'running'
          and j.lease_expires_at <= pg_catalog.now()
        )
      )
      and (
        (
          j.stage in ('validate', 'extract', 'chunk', 'embed', 'finalize')
          and f.deleted_at is null
          and v.status in ('pending_processing', 'processing')
        )
        or (j.stage = 'cleanup' and f.deleted_at is not null)
      )
    for update of j;

    exit when found;
  end loop;

  v_lease_expires_at := pg_catalog.now()
    + pg_catalog.make_interval(secs => v_lease_seconds);

  update public.processing_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      error_code = null,
      worker_id = v_worker_id,
      lease_expires_at = v_lease_expires_at,
      updated_at = pg_catalog.now()
  where j.id = v_job_id
  returning j.attempts into v_attempt;

  if v_stage in ('validate', 'extract', 'chunk', 'embed', 'finalize') then
    if v_version_status = 'pending_processing' then
      update public.file_versions v
      set status = 'processing',
          error_code = null
      where v.id = v_version_id;
    elsif v_version_status <> 'processing' then
      raise exception 'file version is not available for processing';
    end if;
  end if;

  return query
  select
    v_job_id,
    v_version_id,
    v_file_id,
    v_workspace_id,
    v_stage,
    v_storage_path,
    v_original_url,
    v_mime_type,
    v_checksum,
    v_size_bytes,
    v_attempt,
    v_lease_expires_at;
end;
$$;

create or replace function public.heartbeat_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_id text := private.normalize_processing_worker_id(p_worker_id);
  v_lease_seconds integer := private.validate_processing_lease_seconds(
    p_lease_seconds
  );
  v_lease_expires_at timestamptz;
begin
  perform 1
  from private.lock_owned_processing_lease(p_job_id, v_worker_id);

  update public.processing_jobs j
  set lease_expires_at = pg_catalog.now()
        + pg_catalog.make_interval(secs => v_lease_seconds),
      updated_at = pg_catalog.now()
  where j.id = p_job_id
    and j.status = 'running'
    and j.worker_id = v_worker_id
    and j.lease_expires_at > pg_catalog.now()
  returning j.lease_expires_at into v_lease_expires_at;

  if not found then
    raise exception 'active processing lease not owned by worker';
  end if;
  return v_lease_expires_at;
end;
$$;

create or replace function public.complete_processing_stage(
  p_job_id uuid,
  p_worker_id text,
  p_next_stage public.processing_stage
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_id text := private.normalize_processing_worker_id(p_worker_id);
  v_version_id uuid;
  v_stage public.processing_stage;
  v_expected_stage public.processing_stage;
begin
  select lease.version_id, lease.stage
  into v_version_id, v_stage
  from private.lock_owned_processing_lease(p_job_id, v_worker_id) lease;

  v_expected_stage := private.next_active_processing_stage(v_stage);
  if v_stage = 'finalize' or v_stage = 'ocr' then
    raise exception 'stage must use its dedicated terminal path';
  end if;
  if v_stage = 'cleanup' then
    if p_next_stage is not null then
      raise exception 'cleanup has no successor stage';
    end if;
  elsif p_next_stage is distinct from v_expected_stage then
    raise exception 'invalid processing stage transition: % -> %',
      v_stage,
      p_next_stage;
  end if;

  if p_next_stage is not null and exists (
    select 1
    from public.processing_jobs successor
    where successor.version_id = v_version_id
      and successor.stage = p_next_stage
  ) then
    raise exception 'processing successor already exists';
  end if;

  update public.processing_jobs j
  set status = 'succeeded',
      error_code = null,
      worker_id = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where j.id = p_job_id;

  if p_next_stage is not null then
    insert into public.processing_jobs (version_id, stage, status)
    values (v_version_id, p_next_stage, 'pending');
  end if;
end;
$$;

create or replace function public.fail_processing_stage(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_permanent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_id text := private.normalize_processing_worker_id(p_worker_id);
  v_version_id uuid;
  v_stage public.processing_stage;
  v_attempt integer;
  v_workspace_id uuid;
  v_error_code text := private.normalize_processing_error_code(p_error_code);
  v_retry_at timestamptz;
begin
  if p_permanent is null then
    raise exception 'failure permanence is required';
  end if;
  if v_error_code is null then
    raise exception 'processing failure requires an error code';
  end if;

  select
    lease.version_id,
    lease.stage,
    j.attempts,
    lease.workspace_id
  into v_version_id, v_stage, v_attempt, v_workspace_id
  from private.lock_owned_processing_lease(p_job_id, v_worker_id) lease
  join public.processing_jobs j on j.id = p_job_id;

  update public.processing_jobs j
  set status = 'failed',
      error_code = v_error_code,
      worker_id = null,
      lease_expires_at = null,
      updated_at = pg_catalog.now()
  where j.id = p_job_id;

  if not p_permanent and v_attempt < 3 then
    v_retry_at := pg_catalog.now() + case v_attempt
      when 1 then interval '30 seconds'
      when 2 then interval '2 minutes'
    end;

    update public.processing_jobs j
    set status = 'pending',
        available_at = v_retry_at,
        updated_at = pg_catalog.now()
    where j.id = p_job_id;
    return;
  end if;

  if v_stage <> 'cleanup' then
    update public.file_versions v
    set status = 'failed',
        error_code = v_error_code
    where v.id = v_version_id;

    insert into public.audit_events (
      workspace_id,
      actor_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      v_workspace_id,
      null,
      'file_version.finalized',
      'file_version',
      v_version_id,
      pg_catalog.jsonb_build_object(
        'status', 'failed',
        'error_code', v_error_code
      )
    );
  else
    insert into public.audit_events (
      workspace_id,
      actor_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      v_workspace_id,
      null,
      'file.cleanup_failed',
      'file_version',
      v_version_id,
      pg_catalog.jsonb_build_object('error_code', v_error_code)
    );
  end if;
end;
$$;

create or replace function public.record_processing_warning(
  p_job_id uuid,
  p_worker_id text,
  p_code text,
  p_source_location jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_id text := private.normalize_processing_worker_id(p_worker_id);
  v_version_id uuid;
  v_stage public.processing_stage;
  v_code text := private.normalize_processing_error_code(p_code);
  v_warning_id uuid;
begin
  if v_code is null then
    raise exception 'processing warning requires an error code';
  end if;
  if p_source_location is not null
    and not private.is_valid_processing_source_location(p_source_location)
  then
    raise exception 'invalid processing source location';
  end if;

  select lease.version_id, lease.stage
  into v_version_id, v_stage
  from private.lock_owned_processing_lease(p_job_id, v_worker_id) lease;

  insert into public.processing_warnings (
    version_id,
    stage,
    code,
    source_location
  )
  values (v_version_id, v_stage, v_code, p_source_location)
  returning id into v_warning_id;

  return v_warning_id;
end;
$$;

create or replace function public.finalize_processing_version(
  p_job_id uuid,
  p_worker_id text,
  p_status public.file_version_status,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_id text := private.normalize_processing_worker_id(p_worker_id);
  v_version_id uuid;
  v_file_id uuid;
  v_workspace_id uuid;
  v_stage public.processing_stage;
  v_error_code text;
  v_required_succeeded bigint;
  v_chunk_count bigint;
  v_min_chunk_index integer;
  v_max_chunk_index integer;
  v_blank_chunk_count bigint;
  v_warning_count bigint;
begin
  if p_status is null or p_status not in (
    'searchable',
    'partially_searchable',
    'failed'
  ) then
    raise exception 'invalid final file version status';
  end if;

  select
    lease.version_id,
    lease.stage,
    lease.file_id,
    lease.workspace_id
  into v_version_id, v_stage, v_file_id, v_workspace_id
  from private.lock_owned_processing_lease(p_job_id, v_worker_id) lease;
  if v_stage <> 'finalize' then
    raise exception 'finalization requires the finalize stage';
  end if;

  v_error_code := private.normalize_processing_error_code(p_error_code);
  if p_status = 'failed' then
    if v_error_code is null then
      raise exception 'failed version requires an error code';
    end if;

    update public.processing_jobs j
    set status = 'failed',
        error_code = v_error_code,
        worker_id = null,
        lease_expires_at = null,
        updated_at = pg_catalog.now()
    where j.id = p_job_id;

    update public.file_versions v
    set status = 'failed',
        error_code = v_error_code
    where v.id = v_version_id;
  else
    select count(*)
    into v_required_succeeded
    from public.processing_jobs j
    where j.version_id = v_version_id
      and j.stage in ('validate', 'extract', 'chunk', 'embed')
      and j.status = 'succeeded';
    if v_required_succeeded <> 4 then
      raise exception 'publication requires all prerequisite stages to succeed';
    end if;

    select
      count(*),
      min(c.chunk_index),
      max(c.chunk_index),
      count(*) filter (where c.content !~ '[^[:space:]]')
    into
      v_chunk_count,
      v_min_chunk_index,
      v_max_chunk_index,
      v_blank_chunk_count
    from public.content_chunks c
    where c.version_id = v_version_id;
    if v_chunk_count = 0 then
      raise exception 'published version requires content chunks';
    end if;
    if v_min_chunk_index <> 0
      or v_max_chunk_index <> v_chunk_count - 1
    then
      raise exception 'published version requires contiguous zero-based chunk indices';
    end if;
    if v_blank_chunk_count <> 0 then
      raise exception 'published version cannot contain blank content chunks';
    end if;

    -- content_chunks.embedding is extensions.vector(384), so PostgreSQL
    -- enforces vector dimensionality on every insert before finalization.

    select count(*)
    into v_warning_count
    from public.processing_warnings w
    where w.version_id = v_version_id;

    if p_status = 'searchable' then
      if v_warning_count <> 0 then
        raise exception 'searchable version cannot contain processing warnings';
      end if;
      v_error_code := null;
    else
      if v_error_code is null then
        raise exception 'partially searchable version requires an error code';
      end if;
      if v_warning_count = 0 then
        raise exception 'partially searchable version requires a warning';
      end if;
    end if;

    update public.processing_jobs j
    set status = 'succeeded',
        error_code = null,
        worker_id = null,
        lease_expires_at = null,
        updated_at = pg_catalog.now()
    where j.id = p_job_id;

    update public.file_versions v
    set status = p_status,
        error_code = v_error_code
    where v.id = v_version_id;

    update public.files f
    set current_version_id = v_version_id,
        updated_at = pg_catalog.now()
    where f.id = v_file_id
      and f.workspace_id = v_workspace_id
      and f.deleted_at is null;
    if not found then
      raise exception 'file has been deleted';
    end if;
  end if;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values (
    v_workspace_id,
    null,
    'file_version.finalized',
    'file_version',
    v_version_id,
    pg_catalog.jsonb_build_object(
      'status', p_status,
      'error_code', v_error_code
    )
  );
end;
$$;

revoke all on function public.claim_processing_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_processing_job(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_processing_stage(
  uuid,
  text,
  public.processing_stage
) from public, anon, authenticated;
revoke all on function public.fail_processing_stage(uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.record_processing_warning(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_processing_version(
  uuid,
  text,
  public.file_version_status,
  text
) from public, anon, authenticated;

grant execute on function public.claim_processing_job(text, integer)
  to service_role;
grant execute on function public.heartbeat_processing_job(uuid, text, integer)
  to service_role;
grant execute on function public.complete_processing_stage(
  uuid,
  text,
  public.processing_stage
) to service_role;
grant execute on function public.fail_processing_stage(uuid, text, text, boolean)
  to service_role;
grant execute on function public.record_processing_warning(uuid, text, text, jsonb)
  to service_role;
grant execute on function public.finalize_processing_version(
  uuid,
  text,
  public.file_version_status,
  text
) to service_role;
