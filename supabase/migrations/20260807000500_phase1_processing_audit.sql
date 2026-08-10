update public.processing_jobs
set attempts = 3
where attempts > 3;

update public.processing_jobs
set error_code = pg_catalog.left(error_code, 100)
where pg_catalog.char_length(error_code) > 100;

update public.file_versions
set error_code = pg_catalog.left(error_code, 100)
where pg_catalog.char_length(error_code) > 100;

alter table public.processing_jobs
  add constraint processing_jobs_attempts_bounded
    check (attempts between 0 and 3),
  add constraint processing_jobs_error_code_bounded
    check (error_code is null or pg_catalog.char_length(error_code) <= 100);

alter table public.file_versions
  add constraint file_versions_error_code_bounded
    check (error_code is null or pg_catalog.char_length(error_code) <= 100);

create or replace function private.is_valid_file_version_transition(
  p_from public.file_version_status,
  p_to public.file_version_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('awaiting_upload', 'pending_processing'),
    ('pending_processing', 'processing'),
    ('pending_processing', 'failed'),
    ('processing', 'searchable'),
    ('processing', 'partially_searchable'),
    ('processing', 'failed'),
    ('failed', 'pending_processing')
  );
$$;

create or replace function private.is_valid_processing_job_transition(
  p_from public.processing_job_status,
  p_to public.processing_job_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('pending', 'running'),
    ('running', 'succeeded'),
    ('running', 'failed'),
    ('failed', 'pending')
  );
$$;

create or replace function private.normalize_processing_error_code(
  p_error_code text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_error_code text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_error_code, ''))
  );
begin
  if v_error_code = '' then
    return null;
  end if;

  v_error_code := pg_catalog.left(v_error_code, 100);
  if v_error_code !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$' then
    raise exception 'error code must contain only machine-readable characters';
  end if;

  return v_error_code;
end;
$$;

create or replace function private.enforce_file_version_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and not private.is_valid_file_version_transition(old.status, new.status)
  then
    raise exception 'invalid file version transition: % -> %',
      old.status,
      new.status;
  end if;

  return new;
end;
$$;

create or replace function private.enforce_processing_job_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and not private.is_valid_processing_job_transition(old.status, new.status)
  then
    raise exception 'invalid processing job transition: % -> %',
      old.status,
      new.status;
  end if;

  return new;
end;
$$;

create or replace function private.enforce_current_file_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_version_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.file_versions v
    where v.id = new.current_version_id
      and v.file_id = new.id
      and v.workspace_id = new.workspace_id
      and v.status in ('searchable', 'partially_searchable')
  ) then
    raise exception 'current file version must be searchable and belong to the file';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_content_chunk_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_status public.file_version_status;
  v_old_current_version_id uuid;
  v_old_deleted_at timestamptz;
  v_new_status public.file_version_status;
  v_new_current_version_id uuid;
  v_new_deleted_at timestamptz;
  v_lock_version_id uuid;
begin
  if tg_op = 'UPDATE' and old.version_id <> new.version_id then
    perform 1
    from public.file_versions v
    where v.id in (old.version_id, new.version_id)
    order by v.id
    for update;
  else
    if tg_op = 'INSERT' then
      v_lock_version_id := new.version_id;
    else
      v_lock_version_id := old.version_id;
    end if;
    perform 1
    from public.file_versions v
    where v.id = v_lock_version_id
    for update;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select v.status, f.current_version_id, f.deleted_at
    into v_old_status, v_old_current_version_id, v_old_deleted_at
    from public.file_versions v
    join public.files f
      on f.id = v.file_id
      and f.workspace_id = v.workspace_id
    where v.id = old.version_id;
    if not found then
      if tg_op = 'DELETE' then
        -- A trusted workspace/file/version FK cascade may have already made
        -- the parent chain invisible to this child BEFORE DELETE trigger.
        return old;
      end if;
      raise exception 'file version not found for content chunk';
    end if;

    if v_old_deleted_at is null
      and (
        v_old_status <> 'processing'
        or v_old_current_version_id = old.version_id
      )
    then
      raise exception 'content chunks are frozen outside a non-current processing version';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select v.status, f.current_version_id, f.deleted_at
    into v_new_status, v_new_current_version_id, v_new_deleted_at
    from public.file_versions v
    join public.files f
      on f.id = v.file_id
      and f.workspace_id = v.workspace_id
    where v.id = new.version_id;
    if not found then
      raise exception 'file version not found for content chunk';
    end if;

    if v_new_deleted_at is not null
      or v_new_status <> 'processing'
      or v_new_current_version_id = new.version_id
    then
      raise exception 'content chunks may be written only to a non-current processing version';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.is_valid_file_version_transition(
  public.file_version_status,
  public.file_version_status
) from public, anon, authenticated;
revoke all on function private.is_valid_processing_job_transition(
  public.processing_job_status,
  public.processing_job_status
) from public, anon, authenticated;
revoke all on function private.normalize_processing_error_code(text)
  from public, anon, authenticated;
revoke all on function private.enforce_file_version_transition()
  from public, anon, authenticated;
revoke all on function private.enforce_processing_job_transition()
  from public, anon, authenticated;
revoke all on function private.enforce_current_file_version()
  from public, anon, authenticated;
revoke all on function private.enforce_content_chunk_mutation()
  from public, anon, authenticated;

create trigger file_versions_enforce_status_transition
before update of status on public.file_versions
for each row
execute function private.enforce_file_version_transition();

create trigger processing_jobs_enforce_status_transition
before update of status on public.processing_jobs
for each row
execute function private.enforce_processing_job_transition();

create trigger files_enforce_current_version
before insert or update of current_version_id on public.files
for each row
execute function private.enforce_current_file_version();

create trigger content_chunks_enforce_processing_version
before insert or update or delete on public.content_chunks
for each row
execute function private.enforce_content_chunk_mutation();

create or replace function public.claim_processing_job()
returns table (
  job_id uuid,
  version_id uuid,
  file_id uuid,
  workspace_id uuid,
  stage public.processing_stage,
  storage_path text,
  original_url text,
  mime_type text,
  attempt integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_version_id uuid;
  v_file_id uuid;
  v_workspace_id uuid;
  v_stage public.processing_stage;
  v_storage_path text;
  v_original_url text;
  v_mime_type text;
  v_attempt integer;
  v_version_status public.file_version_status;
begin
  select
    v.file_id,
    v.workspace_id,
    v.storage_path,
    v.original_url,
    v.mime_type,
    v.id,
    v.status
  into
    v_file_id,
    v_workspace_id,
    v_storage_path,
    v_original_url,
    v_mime_type,
    v_version_id,
    v_version_status
  from public.file_versions v
  join public.files f
    on f.id = v.file_id
    and f.workspace_id = v.workspace_id
  where exists (
    select 1
    from public.processing_jobs candidate
    where candidate.version_id = v.id
      and candidate.status = 'pending'
      and candidate.available_at <= now()
      and candidate.attempts < 3
      and (
        (candidate.stage = 'cleanup' and f.deleted_at is not null)
        or (
          candidate.stage <> 'cleanup'
          and f.deleted_at is null
          and v.status in ('pending_processing', 'processing')
        )
      )
    )
  order by v.created_at, v.id
  limit 1
  for update of v skip locked;

  if not found then
    return;
  end if;

  select j.id, j.stage
  into v_job_id, v_stage
  from public.processing_jobs j
  join public.files f
    on f.id = v_file_id
    and f.workspace_id = v_workspace_id
  where j.version_id = v_version_id
    and j.status = 'pending'
    and j.available_at <= now()
    and j.attempts < 3
    and (
      (j.stage = 'cleanup' and f.deleted_at is not null)
      or (
        j.stage <> 'cleanup'
        and f.deleted_at is null
        and v_version_status in ('pending_processing', 'processing')
      )
    )
  order by j.available_at, j.created_at, j.id
  limit 1
  for update of j skip locked;

  if not found then
    return;
  end if;

  update public.processing_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      error_code = null,
      updated_at = now()
  where j.id = v_job_id
  returning j.attempts into v_attempt;

  if v_stage <> 'cleanup' then
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
    v_attempt;
end;
$$;

create or replace function public.complete_processing_job(
  p_job_id uuid,
  p_succeeded boolean,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.processing_job_status;
  v_stage public.processing_stage;
  v_version_id uuid;
  v_version_status public.file_version_status;
  v_error_code text;
begin
  if p_job_id is null then
    raise exception 'processing job is required';
  end if;
  if p_succeeded is null then
    raise exception 'processing result is required';
  end if;

  select j.version_id, j.stage
  into v_version_id, v_stage
  from public.processing_jobs j
  where j.id = p_job_id;
  if not found then
    raise exception 'processing job not found';
  end if;

  select v.status
  into v_version_status
  from public.file_versions v
  where v.id = v_version_id
  for update;
  if not found then
    raise exception 'file version not found';
  end if;
  if v_stage <> 'cleanup' and v_version_status <> 'processing' then
    raise exception 'file version is not processing';
  end if;

  select j.status
  into v_status
  from public.processing_jobs j
  where j.id = p_job_id
    and j.version_id = v_version_id
  for update;
  if not found then
    raise exception 'processing job not found';
  end if;
  if v_status <> 'running' then
    raise exception 'processing job is not running';
  end if;

  if p_succeeded then
    update public.processing_jobs j
    set status = 'succeeded',
        error_code = null,
        updated_at = now()
    where j.id = p_job_id;
  else
    v_error_code := private.normalize_processing_error_code(p_error_code);
    update public.processing_jobs j
    set status = 'failed',
        error_code = v_error_code,
        updated_at = now()
    where j.id = p_job_id;
  end if;
end;
$$;

create or replace function public.finalize_file_version(
  p_version_id uuid,
  p_status public.file_version_status,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file_id uuid;
  v_workspace_id uuid;
  v_current_status public.file_version_status;
  v_deleted_at timestamptz;
  v_error_code text;
  v_job_count bigint;
  v_succeeded_job_count bigint;
  v_failed_job_count bigint;
  v_nonterminal_job_count bigint;
  v_chunk_count bigint;
begin
  if p_version_id is null then
    raise exception 'file version is required';
  end if;
  if p_status is null or p_status not in (
    'searchable',
    'partially_searchable',
    'failed'
  ) then
    raise exception 'invalid final file version status';
  end if;

  select v.file_id, v.workspace_id, v.status
  into v_file_id, v_workspace_id, v_current_status
  from public.file_versions v
  where v.id = p_version_id
  for update;
  if not found then
    raise exception 'file version not found';
  end if;
  if v_current_status <> 'processing' then
    raise exception 'file version is not processing';
  end if;

  perform 1
  from public.processing_jobs j
  where j.version_id = p_version_id
    and j.stage <> 'cleanup'
  order by j.id
  for update;

  select
    count(*),
    count(*) filter (where j.status = 'succeeded'),
    count(*) filter (where j.status = 'failed'),
    count(*) filter (where j.status in ('pending', 'running'))
  into
    v_job_count,
    v_succeeded_job_count,
    v_failed_job_count,
    v_nonterminal_job_count
  from public.processing_jobs j
  where j.version_id = p_version_id
    and j.stage <> 'cleanup';

  if v_job_count = 0 then
    raise exception 'file version has no processing jobs';
  end if;
  if v_nonterminal_job_count > 0 then
    raise exception 'file version has nonterminal processing jobs';
  end if;

  select count(*)
  into v_chunk_count
  from public.content_chunks c
  where c.version_id = p_version_id;

  select f.deleted_at
  into v_deleted_at
  from public.files f
  where f.id = v_file_id
    and f.workspace_id = v_workspace_id
  for update;
  if not found then
    raise exception 'file not found';
  end if;

  if p_status in ('searchable', 'partially_searchable') then
    if v_deleted_at is not null then
      raise exception 'file has been deleted';
    end if;

    if p_status = 'searchable' then
      if v_succeeded_job_count <> v_job_count
        or v_failed_job_count <> 0
      then
        raise exception 'searchable version requires all jobs to succeed';
      end if;
      if v_chunk_count = 0 then
        raise exception 'searchable version requires content chunks';
      end if;
      v_error_code := null;
    else
      if v_succeeded_job_count = 0 then
        raise exception 'partially searchable version requires a succeeded job';
      end if;
      if v_chunk_count = 0 then
        raise exception 'partially searchable version requires content chunks';
      end if;
      v_error_code := private.normalize_processing_error_code(p_error_code);
      if v_error_code is null then
        raise exception 'partially searchable version requires an error code';
      end if;
    end if;

    update public.file_versions v
    set status = p_status,
        error_code = v_error_code
    where v.id = p_version_id;

    update public.files f
    set current_version_id = p_version_id,
        updated_at = now()
    from public.file_versions v
    where v.id = p_version_id
      and v.file_id = f.id
      and v.workspace_id = f.workspace_id
      and f.id = v_file_id
      and f.deleted_at is null;
  else
    if v_failed_job_count = 0 then
      raise exception 'failed version requires a failed processing job';
    end if;
    v_error_code := private.normalize_processing_error_code(p_error_code);
    update public.file_versions v
    set status = 'failed',
        error_code = v_error_code
    where v.id = p_version_id;
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
    p_version_id,
    pg_catalog.jsonb_build_object(
      'status', p_status,
      'error_code', v_error_code
    )
  );
end;
$$;

create or replace function public.retry_file_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_file_id uuid;
  v_workspace_id uuid;
  v_status public.file_version_status;
  v_failed_job_count bigint;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_version_id is null then
    raise exception 'file version is required';
  end if;

  select v.file_id, v.workspace_id, v.status
  into v_file_id, v_workspace_id, v_status
  from public.file_versions v
  where v.id = p_version_id
  for update;
  if not found then
    raise exception 'file version not found';
  end if;
  if not private.can_manage_file(v_file_id) then
    raise exception 'file management required';
  end if;
  if v_status <> 'failed' then
    raise exception 'file version is not failed';
  end if;

  perform 1
  from public.processing_jobs j
  where j.version_id = p_version_id
    and j.status = 'failed'
  order by j.id
  for update;

  select count(*)
  into v_failed_job_count
  from public.processing_jobs j
  where j.version_id = p_version_id
    and j.status = 'failed';

  if v_failed_job_count = 0 then
    raise exception 'file version has no failed processing job';
  end if;
  if exists (
    select 1
    from public.processing_jobs j
    where j.version_id = p_version_id
      and j.status = 'failed'
      and j.attempts >= 3
  ) then
    raise exception 'processing retry limit reached';
  end if;

  update public.processing_jobs j
  set status = 'pending',
      error_code = null,
      available_at = now(),
      updated_at = now()
  where j.version_id = p_version_id
    and j.status = 'failed';

  update public.file_versions v
  set status = 'pending_processing',
      error_code = null
  where v.id = p_version_id;

  insert into public.audit_events (
    workspace_id,
    actor_id,
    action,
    target_type,
    target_id
  )
  values (
    v_workspace_id,
    v_actor,
    'file_version.retry_requested',
    'file_version',
    p_version_id
  );
end;
$$;

revoke insert, update, delete on public.audit_events
  from public, anon, authenticated;

revoke insert, update, delete, truncate on
  public.files,
  public.file_versions,
  public.processing_jobs
from service_role;
grant select on
  public.files,
  public.file_versions,
  public.processing_jobs
to service_role;

revoke insert, update, delete, truncate on public.content_chunks
  from service_role;
grant select, insert, update, delete on public.content_chunks
  to service_role;

revoke update, delete, truncate on public.audit_events
  from service_role;
grant select, insert on public.audit_events
  to service_role;

revoke all on function public.claim_processing_job()
  from public, anon, authenticated;
revoke all on function public.complete_processing_job(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.finalize_file_version(
  uuid,
  public.file_version_status,
  text
) from public, anon, authenticated;
revoke all on function public.retry_file_version(uuid)
  from public, anon, authenticated;

grant execute on function public.claim_processing_job()
  to service_role;
grant execute on function public.complete_processing_job(uuid, boolean, text)
  to service_role;
grant execute on function public.finalize_file_version(
  uuid,
  public.file_version_status,
  text
) to service_role;
grant execute on function public.retry_file_version(uuid)
  to authenticated;
