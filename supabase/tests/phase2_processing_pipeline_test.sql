-- UNRUN until a dedicated database target is separately authorized.
-- These are pgTAP database-behavior tests. They must not be treated as
-- executed evidence until run against an explicitly approved disposable DB.

begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(64);

insert into auth.users (id, email)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'phase2-processing@example.test'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'phase2-nonmember@example.test'
  );

insert into public.workspaces (id, name, created_by)
values (
  '20000000-0000-4000-8000-000000000001',
  'Phase 2 processing',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.memberships (workspace_id, user_id, role)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'member'
);

-- Chunk index and source-location constraints.
insert into public.files (
  id,
  workspace_id,
  uploader_id,
  display_name,
  source_type
)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'chunk-constraints.pdf',
  'web'
);

insert into public.file_versions (
  id,
  file_id,
  workspace_id,
  created_by,
  original_url,
  mime_type,
  status
)
values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'https://example.test/chunk-constraints.pdf',
  'application/pdf',
  'processing'
);

insert into public.content_chunks (
  version_id,
  chunk_index,
  content,
  source_location,
  search_tokens,
  embedding
)
values (
  '40000000-0000-4000-8000-000000000001',
  0,
  'first chunk',
  '{"schemaVersion":1,"kind":"page","page":1,"label":"Page 1"}',
  array['first', 'chunk'],
  pg_catalog.array_fill(0.1::real, array[384])::extensions.vector
);

select extensions.throws_matching(
  $$
    insert into public.content_chunks (
      version_id,
      chunk_index,
      content,
      source_location,
      embedding
    ) values (
      '40000000-0000-4000-8000-000000000001',
      0,
      'duplicate index',
      '{"schemaVersion":1,"kind":"page","page":2,"label":"Page 2"}',
      pg_catalog.array_fill(0.1::real, array[384])::extensions.vector
    )
  $$,
  'duplicate key value violates unique constraint.*',
  'chunk indices are unique within a version'
);

select extensions.throws_matching(
  $$
    insert into public.content_chunks (
      version_id,
      chunk_index,
      content,
      source_location,
      embedding
    ) values (
      '40000000-0000-4000-8000-000000000001',
      1,
      'invalid location',
      '{"schemaVersion":1,"kind":"document","blockType":"table","blockStart":2,"blockEnd":1,"tableIndex":1,"rowStart":0,"rowEnd":1,"label":""}',
      pg_catalog.array_fill(0.1::real, array[384])::extensions.vector
    )
  $$,
  'new row for relation "content_chunks" violates check constraint.*',
  'invalid structured source locations are rejected'
);

select extensions.is(
  private.is_valid_processing_source_location(
    '{"schemaVersion":1,"kind":"document","blockStart":1,"blockEnd":1,"label":"Paragraph 1"}'
  ),
  false,
  'document locations reject a missing blockType key'
);

select extensions.is(
  private.is_valid_processing_source_location(
    '{"schemaVersion":1,"kind":"document","blockType":null,"blockStart":1,"blockEnd":1,"label":"Paragraph 1"}'
  ),
  false,
  'document locations reject a null blockType'
);

select extensions.is(
  private.is_valid_processing_source_location(
    '{"schemaVersion":1,"kind":"document","blockType":"paragraph","blockStart":1,"blockEnd":1,"headingPath":[],"label":"Paragraph 1"}'
  ),
  false,
  'document locations reject an empty headingPath'
);

select extensions.is(
  private.is_valid_processing_source_location(
    '{"schemaVersion":1,"kind":"document","blockType":"paragraph","blockStart":1,"blockEnd":1,"headingPath":["  "],"label":"Paragraph 1"}'
  ),
  false,
  'document locations reject whitespace-only headingPath items'
);

select extensions.is(
  private.is_valid_processing_source_location(
    '{"schemaVersion":1,"kind":"document","blockType":"paragraph","blockStart":1,"blockEnd":1,"headingPath":["\t\n"],"label":"Paragraph 1"}'
  ),
  false,
  'document locations reject tab/newline-only headingPath items'
);

select extensions.is(
  private.is_valid_processing_source_location(
    '{"schemaVersion":1,"kind":"page","page":1,"label":"   "}'
  ),
  false,
  'source locations reject whitespace-only labels'
);

select extensions.is(
  private.is_valid_processing_source_location(
    '{"schemaVersion":1,"kind":"page","page":1,"label":"\t\n"}'
  ),
  false,
  'source locations reject tab/newline-only labels'
);

select extensions.is(
  private.is_valid_processing_source_location(
    '{"schemaVersion":1,"kind":"page","page":1,"label":7}'
  ),
  false,
  'source locations reject a non-string label type'
);

select extensions.ok(
  exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.content_chunks'::pg_catalog.regclass
      and t.tgname = 'content_chunks_enforce_processing_version'
      and t.tgenabled = 'O'
      and not t.tgisinternal
  ),
  'the named Phase 1 content-chunk freeze trigger is enabled post-migration'
);

-- Lease ownership, expired reclaim, and legal successor insertion.
insert into public.files (
  id,
  workspace_id,
  uploader_id,
  display_name,
  source_type
)
values (
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'lease.pdf',
  'web'
);

insert into public.file_versions (
  id,
  file_id,
  workspace_id,
  created_by,
  original_url,
  mime_type,
  status
)
values (
  '40000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'https://example.test/lease.pdf',
  'application/pdf',
  'pending_processing'
);

insert into public.processing_jobs (id, version_id, stage, status)
values (
  '50000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000002',
  'validate',
  'pending'
);

select extensions.ok(
  (
    select claimed.checksum is null and claimed.size_bytes is null
    from public.claim_processing_job('lease-worker-a', 120) claimed
  ),
  'claim exposes nullable checksum and size for fail-closed source handling'
);

select extensions.is(
  (
    select j.worker_id
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000002'
  ),
  'lease-worker-a',
  'claim records the lease owner'
);

select extensions.is(
  (
    select j.attempts
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000002'
  ),
  1,
  'first claim records attempt one'
);

select extensions.throws_ok(
  $$
    select public.heartbeat_processing_job(
      '50000000-0000-4000-8000-000000000002',
      'lease-worker-b',
      120
    )
  $$,
  'active processing lease not owned by worker',
  'a worker cannot heartbeat another worker lease'
);

select extensions.throws_ok(
  $$
    select public.complete_processing_stage(
      '50000000-0000-4000-8000-000000000002',
      'lease-worker-b',
      'extract'
    )
  $$,
  'active processing lease not owned by worker',
  'a worker cannot complete another worker lease'
);

update public.processing_jobs
set lease_expires_at = pg_catalog.now() - interval '1 second'
where id = '50000000-0000-4000-8000-000000000002';

do $$
begin
  perform 1
  from public.claim_processing_job('lease-worker-b', 120);
end;
$$;

select extensions.is(
  (
    select j.worker_id
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000002'
  ),
  'lease-worker-b',
  'an expired lease is reclaimed by the new worker'
);

select extensions.is(
  (
    select j.attempts
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000002'
  ),
  2,
  'expired lease reclaim consumes the second attempt'
);

select extensions.throws_ok(
  $$
    select public.complete_processing_stage(
      '50000000-0000-4000-8000-000000000002',
      'lease-worker-b',
      'chunk'
    )
  $$,
  'invalid processing stage transition: validate -> chunk',
  'a stage cannot skip its successor'
);

select extensions.throws_ok(
  $$
    select public.complete_processing_stage(
      '50000000-0000-4000-8000-000000000002',
      'lease-worker-b',
      'validate'
    )
  $$,
  'invalid processing stage transition: validate -> validate',
  'a stage cannot repeat itself'
);

select extensions.lives_ok(
  $$
    select public.complete_processing_stage(
      '50000000-0000-4000-8000-000000000002',
      'lease-worker-b',
      'extract'
    )
  $$,
  'the immediate successor transition succeeds'
);

select extensions.is(
  (
    select count(*)::integer
    from public.processing_jobs j
    where j.version_id = '40000000-0000-4000-8000-000000000002'
      and j.stage = 'extract'
  ),
  1,
  'stage completion atomically creates exactly one successor'
);

do $$
begin
  perform 1
  from public.claim_processing_job('lease-worker-b', 120);
end;
$$;

select extensions.throws_ok(
  $$
    select public.complete_processing_stage(
      (
        select j.id
        from public.processing_jobs j
        where j.version_id = '40000000-0000-4000-8000-000000000002'
          and j.stage = 'extract'
      ),
      'lease-worker-b',
      'validate'
    )
  $$,
  'invalid processing stage transition: extract -> validate',
  'a stage cannot move backward'
);

update public.files
set deleted_at = pg_catalog.now(),
    deleted_by = '10000000-0000-4000-8000-000000000001'
where id = '30000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$
    select public.complete_processing_stage(
      (
        select j.id
        from public.processing_jobs j
        where j.version_id = '40000000-0000-4000-8000-000000000002'
          and j.stage = 'extract'
      ),
      'lease-worker-b',
      'chunk'
    )
  $$,
  'active processing stage cannot mutate a deleted file',
  'completion rechecks deletion state while holding the file lock'
);

insert into public.processing_jobs (version_id, stage, status)
values (
  '40000000-0000-4000-8000-000000000001',
  'ocr',
  'pending'
);

select extensions.is(
  (
    select count(*)::integer
    from public.claim_processing_job('ocr-probe-worker', 120)
  ),
  0,
  'claim never selects OCR outside the explicit Phase 2 allowlist'
);

delete from public.processing_jobs
where version_id = '40000000-0000-4000-8000-000000000001'
  and stage = 'ocr';

delete from public.files
where id = '30000000-0000-4000-8000-000000000002';

-- An abandoned third active attempt becomes terminal on the next poll.
insert into public.files (
  id,
  workspace_id,
  uploader_id,
  display_name,
  source_type
)
values (
  '30000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'expired-third.pdf',
  'web'
);

insert into public.file_versions (
  id,
  file_id,
  workspace_id,
  created_by,
  original_url,
  mime_type,
  status
)
values (
  '40000000-0000-4000-8000-000000000007',
  '30000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'https://example.test/expired-third.pdf',
  'application/pdf',
  'processing'
);

insert into public.processing_jobs (
  id,
  version_id,
  stage,
  status,
  attempts,
  worker_id,
  lease_expires_at
)
values (
  '50000000-0000-4000-8000-000000000007',
  '40000000-0000-4000-8000-000000000007',
  'embed',
  'running',
  3,
  'expired-worker',
  pg_catalog.now() - interval '1 second'
);

do $$
begin
  perform 1 from public.claim_processing_job('poll-worker', 120);
end;
$$;

select extensions.is(
  (
    select j.status
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000007'
  ),
  'failed'::public.processing_job_status,
  'an expired third active attempt is terminalized during polling'
);

select extensions.is(
  (
    select v.status
    from public.file_versions v
    where v.id = '40000000-0000-4000-8000-000000000007'
  ),
  'failed'::public.file_version_status,
  'expired third-attempt terminalization atomically fails the version'
);

select extensions.is(
  (
    select count(*)::integer
    from public.audit_events a
    where a.target_id = '40000000-0000-4000-8000-000000000007'
      and a.action = 'file_version.finalized'
  ),
  1,
  'expired active terminalization records one version finalization audit'
);

-- Exhausted cleanup remains distinct and never changes version publication.
insert into public.files (
  id,
  workspace_id,
  uploader_id,
  display_name,
  source_type,
  deleted_at,
  deleted_by
)
values (
  '30000000-0000-4000-8000-000000000008',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'cleanup.pdf',
  'web',
  pg_catalog.now(),
  '10000000-0000-4000-8000-000000000001'
);

insert into public.file_versions (
  id,
  file_id,
  workspace_id,
  created_by,
  original_url,
  mime_type,
  status
)
values (
  '40000000-0000-4000-8000-000000000008',
  '30000000-0000-4000-8000-000000000008',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'https://example.test/cleanup.pdf',
  'application/pdf',
  'searchable'
);

insert into public.processing_jobs (
  id,
  version_id,
  stage,
  status,
  attempts,
  worker_id,
  lease_expires_at
)
values (
  '50000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000008',
  'cleanup',
  'running',
  3,
  'cleanup-worker',
  pg_catalog.now() - interval '1 second'
);

do $$
begin
  perform 1 from public.claim_processing_job('poll-worker', 120);
end;
$$;

select extensions.is(
  (
    select v.status
    from public.file_versions v
    where v.id = '40000000-0000-4000-8000-000000000008'
  ),
  'searchable'::public.file_version_status,
  'cleanup exhaustion does not change file-version publication status'
);

select extensions.is(
  (
    select count(*)::integer
    from public.audit_events a
    where a.target_id = '40000000-0000-4000-8000-000000000008'
      and a.action = 'file.cleanup_failed'
  ),
  1,
  'cleanup exhaustion records a cleanup-specific audit'
);

select extensions.is(
  (
    select count(*)::integer
    from public.audit_events a
    where a.target_id = '40000000-0000-4000-8000-000000000008'
      and a.action = 'file_version.finalized'
  ),
  0,
  'cleanup exhaustion never records a false version finalization audit'
);

-- Three total attempts and exact retry scheduling.
insert into public.files (
  id,
  workspace_id,
  uploader_id,
  display_name,
  source_type
)
values (
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'retry.pdf',
  'web'
);

insert into public.file_versions (
  id,
  file_id,
  workspace_id,
  created_by,
  original_url,
  mime_type,
  status
)
values (
  '40000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'https://example.test/retry.pdf',
  'application/pdf',
  'pending_processing'
);

insert into public.processing_jobs (id, version_id, stage, status)
values (
  '50000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000003',
  'validate',
  'pending'
);

do $$
begin
  perform 1
  from public.claim_processing_job('retry-worker', 120);
  perform public.fail_processing_stage(
    '50000000-0000-4000-8000-000000000003',
    'retry-worker',
    'worker_timeout',
    false
  );
end;
$$;

select extensions.is(
  (
    select j.status
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000003'
  ),
  'pending'::public.processing_job_status,
  'attempt one transient failure returns the job to pending'
);

select extensions.ok(
  (
    select j.available_at >= pg_catalog.now() + interval '29 seconds'
      and j.available_at <= pg_catalog.now() + interval '31 seconds'
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000003'
  ),
  'attempt one schedules retry after 30 seconds'
);

update public.processing_jobs
set available_at = pg_catalog.now() - interval '1 second'
where id = '50000000-0000-4000-8000-000000000003';
do $$
begin
  perform 1
  from public.claim_processing_job('retry-worker', 120);
  perform public.fail_processing_stage(
    '50000000-0000-4000-8000-000000000003',
    'retry-worker',
    'worker_timeout',
    false
  );
end;
$$;

select extensions.ok(
  (
    select j.available_at >= pg_catalog.now() + interval '119 seconds'
      and j.available_at <= pg_catalog.now() + interval '121 seconds'
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000003'
  ),
  'attempt two schedules retry after two minutes'
);

update public.processing_jobs
set available_at = pg_catalog.now() - interval '1 second'
where id = '50000000-0000-4000-8000-000000000003';
do $$
begin
  perform 1
  from public.claim_processing_job('retry-worker', 120);
  perform public.fail_processing_stage(
    '50000000-0000-4000-8000-000000000003',
    'retry-worker',
    'worker_timeout',
    false
  );
end;
$$;

select extensions.is(
  (
    select j.attempts
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000003'
  ),
  3,
  'the terminal failure records exactly three attempts'
);

select extensions.is(
  (
    select j.status
    from public.processing_jobs j
    where j.id = '50000000-0000-4000-8000-000000000003'
  ),
  'failed'::public.processing_job_status,
  'attempt three failure is terminal without a fourth delay'
);

select extensions.is(
  (
    select v.status
    from public.file_versions v
    where v.id = '40000000-0000-4000-8000-000000000003'
  ),
  'failed'::public.file_version_status,
  'terminal job failure atomically fails the replacement version'
);

select extensions.is(
  (
    select count(*)::integer
    from public.claim_processing_job('retry-worker', 120)
  ),
  0,
  'no fourth attempt can be claimed'
);

-- Partial publication and failed replacement current-version preservation.
insert into public.files (
  id,
  workspace_id,
  uploader_id,
  display_name,
  source_type
)
values (
  '30000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'publication.pdf',
  'web'
);

insert into public.file_versions (
  id,
  file_id,
  workspace_id,
  created_by,
  original_url,
  mime_type,
  status
)
values
  (
    '40000000-0000-4000-8000-000000000004',
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'https://example.test/old.pdf',
    'application/pdf',
    'searchable'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'https://example.test/partial.pdf',
    'application/pdf',
    'processing'
  );

update public.files
set current_version_id = '40000000-0000-4000-8000-000000000004'
where id = '30000000-0000-4000-8000-000000000004';

insert into public.processing_jobs (
  id,
  version_id,
  stage,
  status,
  attempts,
  worker_id,
  lease_expires_at
)
values
  (
    '50000000-0000-4000-8000-000000000010',
    '40000000-0000-4000-8000-000000000005',
    'validate',
    'succeeded',
    1,
    null,
    null
  ),
  (
    '50000000-0000-4000-8000-000000000011',
    '40000000-0000-4000-8000-000000000005',
    'extract',
    'succeeded',
    1,
    null,
    null
  ),
  (
    '50000000-0000-4000-8000-000000000012',
    '40000000-0000-4000-8000-000000000005',
    'chunk',
    'succeeded',
    1,
    null,
    null
  ),
  (
    '50000000-0000-4000-8000-000000000013',
    '40000000-0000-4000-8000-000000000005',
    'embed',
    'succeeded',
    1,
    null,
    null
  ),
  (
    '50000000-0000-4000-8000-000000000014',
    '40000000-0000-4000-8000-000000000005',
    'finalize',
    'running',
    1,
    'publish-worker',
    pg_catalog.now() + interval '2 minutes'
  );

insert into public.content_chunks (
  version_id,
  chunk_index,
  content,
  source_location,
  search_tokens,
  embedding
)
values (
  '40000000-0000-4000-8000-000000000005',
  0,
  'partially searchable',
  '{"schemaVersion":1,"kind":"page","page":1,"label":"Page 1"}',
  array['partially', 'searchable'],
  pg_catalog.array_fill(0.1::real, array[384])::extensions.vector
);

update public.content_chunks
set chunk_index = 1
where version_id = '40000000-0000-4000-8000-000000000005';

select extensions.throws_ok(
  $$
    select public.finalize_processing_version(
      '50000000-0000-4000-8000-000000000014',
      'publish-worker',
      'searchable',
      null
    )
  $$,
  'published version requires contiguous zero-based chunk indices',
  'publication rejects a gap before the first chunk index'
);

update public.content_chunks
set chunk_index = 0,
    content = E'\t\n'
where version_id = '40000000-0000-4000-8000-000000000005';

select extensions.throws_ok(
  $$
    select public.finalize_processing_version(
      '50000000-0000-4000-8000-000000000014',
      'publish-worker',
      'searchable',
      null
    )
  $$,
  'published version cannot contain blank content chunks',
  'publication rejects tab/newline-only chunk content'
);

update public.content_chunks
set content = 'partially searchable'
where version_id = '40000000-0000-4000-8000-000000000005';

select extensions.lives_ok(
  $$
    select public.record_processing_warning(
      '50000000-0000-4000-8000-000000000014',
      'publish-worker',
      'some_pages_unavailable',
      '{"schemaVersion":1,"kind":"page","page":2,"label":"Page 2"}'
    )
  $$,
  'the lease owner can record a structured partial warning'
);

select extensions.is(
  (
    select count(*)::integer
    from public.processing_warnings w
    where w.version_id = '40000000-0000-4000-8000-000000000005'
  ),
  1,
  'partial warnings are stored against the processing version'
);

do $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',
    true
  );
end;
$$;
set local role authenticated;
select extensions.is(
  (
    select count(*)::integer
    from public.processing_warnings w
    where w.version_id = '40000000-0000-4000-8000-000000000005'
  ),
  0,
  'a non-member cannot read processing warnings through RLS'
);
reset role;

do $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
  );
end;
$$;
set local role authenticated;
select extensions.is(
  (
    select count(*)::integer
    from public.processing_warnings w
    where w.version_id = '40000000-0000-4000-8000-000000000005'
  ),
  1,
  'an active workspace member can read processing warnings through RLS'
);
reset role;

select extensions.lives_ok(
  $$
    select public.finalize_processing_version(
      '50000000-0000-4000-8000-000000000014',
      'publish-worker',
      'partially_searchable',
      'some_pages_unavailable'
    )
  $$,
  'finalization atomically publishes a valid partial version'
);

select extensions.is(
  (
    select v.status
    from public.file_versions v
    where v.id = '40000000-0000-4000-8000-000000000005'
  ),
  'partially_searchable'::public.file_version_status,
  'the partial replacement reaches its final version status'
);

select extensions.is(
  (
    select f.current_version_id
    from public.files f
    where f.id = '30000000-0000-4000-8000-000000000004'
  ),
  '40000000-0000-4000-8000-000000000005'::uuid,
  'successful partial publication switches the current version'
);

insert into public.file_versions (
  id,
  file_id,
  workspace_id,
  created_by,
  original_url,
  mime_type,
  status
)
values (
  '40000000-0000-4000-8000-000000000006',
  '30000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'https://example.test/failed-replacement.pdf',
  'application/pdf',
  'processing'
);

insert into public.processing_jobs (
  id,
  version_id,
  stage,
  status,
  attempts,
  worker_id,
  lease_expires_at
)
values (
  '50000000-0000-4000-8000-000000000015',
  '40000000-0000-4000-8000-000000000006',
  'finalize',
  'running',
  1,
  'failed-publish-worker',
  pg_catalog.now() + interval '2 minutes'
);

select extensions.lives_ok(
  $$
    select public.finalize_processing_version(
      '50000000-0000-4000-8000-000000000015',
      'failed-publish-worker',
      'failed',
      'database_write_failed'
    )
  $$,
  'a leased finalize job can atomically fail its replacement version'
);

select extensions.is(
  (
    select v.status
    from public.file_versions v
    where v.id = '40000000-0000-4000-8000-000000000006'
  ),
  'failed'::public.file_version_status,
  'failed finalization marks only the replacement as failed'
);

select extensions.is(
  (
    select f.current_version_id
    from public.files f
    where f.id = '30000000-0000-4000-8000-000000000004'
  ),
  '40000000-0000-4000-8000-000000000005'::uuid,
  'a failed replacement preserves the previous current version'
);

-- Worker-only grants, legacy revocation, and private artifact boundaries.
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_processing_job()',
    'EXECUTE'
  ),
  'Service Role cannot execute the legacy no-argument claim RPC'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.complete_processing_job(uuid,boolean,text)',
    'EXECUTE'
  ),
  'Service Role cannot execute the legacy completion RPC'
);

select extensions.ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.finalize_file_version(uuid,public.file_version_status,text)',
    'EXECUTE'
  ),
  'Service Role cannot execute the legacy finalization RPC'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_processing_job(text,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_processing_job(text,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.claim_processing_job(text,integer)',
    'EXECUTE'
  ),
  'claim_processing_job is executable only by Service Role'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.heartbeat_processing_job(uuid,text,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.heartbeat_processing_job(uuid,text,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.heartbeat_processing_job(uuid,text,integer)',
    'EXECUTE'
  ),
  'heartbeat_processing_job is executable only by Service Role'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.complete_processing_stage(uuid,text,public.processing_stage)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_processing_stage(uuid,text,public.processing_stage)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.complete_processing_stage(uuid,text,public.processing_stage)',
    'EXECUTE'
  ),
  'complete_processing_stage is executable only by Service Role'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.fail_processing_stage(uuid,text,text,boolean)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.fail_processing_stage(uuid,text,text,boolean)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.fail_processing_stage(uuid,text,text,boolean)',
    'EXECUTE'
  ),
  'fail_processing_stage is executable only by Service Role'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.record_processing_warning(uuid,text,text,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_processing_warning(uuid,text,text,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.record_processing_warning(uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'record_processing_warning is executable only by Service Role'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.finalize_processing_version(uuid,text,public.file_version_status,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.finalize_processing_version(uuid,text,public.file_version_status,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.finalize_processing_version(uuid,text,public.file_version_status,text)',
    'EXECUTE'
  ),
  'finalize_processing_version is executable only by Service Role'
);

select extensions.is(
  (
    select b.public
    from storage.buckets b
    where b.id = 'processing-artifacts'
  ),
  false,
  'processing artifacts are stored in a private bucket'
);

select extensions.is(
  (
    select b.file_size_limit
    from storage.buckets b
    where b.id = 'processing-artifacts'
  ),
  100000000::bigint,
  'processing artifacts use the 100 MB decimal object limit'
);

select extensions.is(
  (
    select b.allowed_mime_types
    from storage.buckets b
    where b.id = 'processing-artifacts'
  ),
  array['application/gzip']::text[],
  'processing artifacts accept only the gzip MIME type'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and (
        coalesce(p.qual, '') like '%processing-artifacts%'
        or coalesce(p.with_check, '') like '%processing-artifacts%'
      )
      and p.roles && array['public', 'anon', 'authenticated']::name[]
  ),
  'no anon or authenticated object policy names the processing artifact bucket'
);

select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated',
    'public.processing_warnings',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'public.processing_warnings',
    'INSERT,UPDATE,DELETE'
  )
  and pg_catalog.has_table_privilege(
    'service_role',
    'public.processing_warnings',
    'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'public.processing_warnings',
    'UPDATE,DELETE'
  ),
  'processing warnings are readable by members and append-only for Service Role'
);

select * from extensions.finish();
rollback;
