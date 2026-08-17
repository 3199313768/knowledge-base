import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  currentDir,
  '../../../supabase/migrations/20260807000400_phase1_files_storage.sql'
);
const hybridSearchMigrationPath = resolve(
  currentDir,
  '../../../supabase/migrations/20260810000200_phase2_hybrid_search.sql'
);
const filesStorageCloudTestPath = resolve(
  currentDir,
  './files-storage.cloud.test.ts'
);

it('does not attempt to own Supabase managed storage.objects RLS state', () => {
  const migration = readFileSync(migrationPath, 'utf8');

  expect(migration).not.toMatch(
    /\balter\s+table\s+storage\.objects\s+enable\s+row\s+level\s+security\b/i
  );
});

it('uses PostgreSQL exception condition names accepted by Supabase migrations', () => {
  const migration = readFileSync(hybridSearchMigrationPath, 'utf8');

  expect(migration).not.toContain('datetime_value_out_of_range');
});

it('keeps cloud tests on the Phase 2 worker RPC contract', () => {
  const testSource = readFileSync(filesStorageCloudTestPath, 'utf8');

  expect(testSource).not.toMatch(/rpc\(['"]claim_processing_job['"]\)/);
  expect(testSource).not.toContain("'complete_processing_job'");
  expect(testSource).not.toContain("'finalize_file_version'");
});
