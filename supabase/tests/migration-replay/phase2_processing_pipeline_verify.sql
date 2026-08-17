-- UNRUN until a dedicated disposable migration-replay database is authorized.
-- PRECONDITION: run the Phase 1 fixture, then apply the Phase 2 migration once.

begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

select extensions.is(
  (
    select c.chunk_index
    from public.content_chunks c
    where c.id = '96000000-0000-4000-8000-000000000001'
  ),
  0,
  'the published legacy chunk receives deterministic index zero'
);

select extensions.is(
  (
    select c.search_tokens
    from public.content_chunks c
    where c.id = '96000000-0000-4000-8000-000000000001'
  ),
  '{}'::text[],
  'the published legacy chunk receives the empty lexical-token default'
);

select extensions.is(
  (
    select c.source_location
    from public.content_chunks c
    where c.id = '96000000-0000-4000-8000-000000000001'
  ),
  '{"schemaVersion":1,"kind":"page","page":1,"label":"Page 1"}'::jsonb,
  'the legacy page location is upgraded and its blank control label replaced'
);

select extensions.is(
  (
    select f.current_version_id
    from public.files f
    where f.id = '93000000-0000-4000-8000-000000000001'
  ),
  '94000000-0000-4000-8000-000000000001'::uuid,
  'historical backfill preserves the published current version'
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
  'the named Phase 1 chunk-freeze trigger is restored after migration'
);

select extensions.throws_matching(
  $$
    update public.content_chunks
    set content = 'forbidden published mutation'
    where id = '96000000-0000-4000-8000-000000000001'
  $$,
  'content chunks are frozen outside a non-current processing version',
  'the restored trigger still freezes a current published chunk'
);

select extensions.is(
  (
    select j.status
    from public.processing_jobs j
    where j.id = '95000000-0000-4000-8000-000000000002'
  ),
  'pending'::public.processing_job_status,
  'the ownerless Phase 1 running job becomes reclaimable pending work'
);

select extensions.is(
  (
    select j.attempts
    from public.processing_jobs j
    where j.id = '95000000-0000-4000-8000-000000000002'
  ),
  1,
  'migration recovery preserves the already-consumed attempt count'
);

select extensions.ok(
  (
    select j.worker_id is null and j.lease_expires_at is null
    from public.processing_jobs j
    where j.id = '95000000-0000-4000-8000-000000000002'
  ),
  'the recovered pending job carries no fake runtime lease owner'
);

select extensions.is(
  (
    select j.status
    from public.processing_jobs j
    where j.id = '95000000-0000-4000-8000-000000000003'
  ),
  'failed'::public.processing_job_status,
  'pending legacy OCR work is terminalized outside the active allowlist'
);

select extensions.is(
  (
    select j.error_code
    from public.processing_jobs j
    where j.id = '95000000-0000-4000-8000-000000000003'
  ),
  'ocr_required',
  'terminalized OCR work records the stable OCR-required code'
);

select extensions.is(
  (
    select v.status
    from public.file_versions v
    where v.id = '94000000-0000-4000-8000-000000000003'
  ),
  'failed'::public.file_version_status,
  'terminalized pending OCR work atomically fails its version'
);

select extensions.ok(
  not exists (
    select 1
    from public.processing_jobs j
    where j.worker_id in (
      'phase2-migration-recovery',
      'phase2-migration-ocr-terminal'
    )
  ),
  'migration-only recovery markers do not survive replay'
);

select * from extensions.finish();
rollback;
