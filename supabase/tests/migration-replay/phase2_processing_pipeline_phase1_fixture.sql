-- UNRUN until a dedicated disposable migration-replay database is authorized.
-- PRECONDITION: migrations through 20260807000500_phase1_processing_audit.sql
-- are applied, and 20260810000100_phase2_processing_pipeline.sql is not.

begin;

insert into auth.users (id, email)
values (
  '91000000-0000-4000-8000-000000000001',
  'phase2-replay@example.test'
);

insert into public.workspaces (id, name, created_by)
values (
  '92000000-0000-4000-8000-000000000001',
  'Phase 2 migration replay',
  '91000000-0000-4000-8000-000000000001'
);

insert into public.memberships (workspace_id, user_id, role)
values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'admin'
);

insert into public.files (
  id,
  workspace_id,
  uploader_id,
  display_name,
  source_type
)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'published-legacy.pdf',
    'web'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'ownerless-running.pdf',
    'web'
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'pending-ocr.pdf',
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
    '94000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'https://example.test/published-legacy.pdf',
    'application/pdf',
    'processing'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'https://example.test/ownerless-running.pdf',
    'application/pdf',
    'processing'
  ),
  (
    '94000000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'https://example.test/pending-ocr.pdf',
    'application/pdf',
    'pending_processing'
  );

-- Phase 1 accepts this page-only location. Its tab/newline-only label verifies
-- that the Phase 2 replay generates a stable nonblank label.
insert into public.content_chunks (
  id,
  version_id,
  content,
  source_location,
  embedding
)
values (
  '96000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'legacy published content',
  '{"page":1,"label":"\t\n"}',
  pg_catalog.array_fill(0.1::real, array[384])::extensions.vector
);

update public.file_versions
set status = 'searchable'
where id = '94000000-0000-4000-8000-000000000001';

update public.files
set current_version_id = '94000000-0000-4000-8000-000000000001'
where id = '93000000-0000-4000-8000-000000000001';

-- Phase 1 running jobs have no owner/lease columns. Phase 2 must recover this
-- row through legal trigger transitions without reopening unrelated failures.
insert into public.processing_jobs (
  id,
  version_id,
  stage,
  status,
  attempts
)
values
  (
    '95000000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000002',
    'validate',
    'running',
    1
  ),
  (
    '95000000-0000-4000-8000-000000000003',
    '94000000-0000-4000-8000-000000000003',
    'ocr',
    'pending',
    0
  );

commit;
