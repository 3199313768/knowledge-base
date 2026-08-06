# Cloud Workspace Isolation Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Docker-dependent linked pgTAP gate with a real Vitest integration test against the dedicated Supabase cloud development project.

**Architecture:** Add one focused helper that owns synthetic cloud-test data and guaranteed cleanup, then exercise it from Vitest against the real `match_spike_chunks` RPC. Keep the SQL pgTAP file as an optional asset and update Phase 0 documentation only after fresh verification.

**Tech Stack:** TypeScript, Vitest, `@supabase/supabase-js`, Supabase PostgreSQL/pgvector.

## Global Constraints

- Use only the dedicated Supabase development project; never target production.
- Read `SUPABASE_SERVICE_ROLE_KEY` only from ignored `.env.local`; never expose or log it in frontend code.
- Use unique synthetic IDs for every run and delete only those IDs in `finally`.
- This test validates RPC workspace filtering, not RLS; RLS remains Phase 1 scope.
- Do not commit or push until every available gate has fresh evidence; preserve `NO-GO` if cloud verification cannot run.

---

### Task 1: Add the real cloud workspace-isolation gate

**Files:**

- Create: `apps/search-spike/src/cloud-isolation.test.ts`
- Create: `apps/search-spike/src/cloudIsolation.ts`
- Modify: `README.md`
- Modify: `validation/phase-0/decision.md`
- Modify: `outputs/knowledge-base-phase-0-technical-validation-plan.md` (ignored local plan)

**Interfaces:**

- Consumes: remote RPC `match_spike_chunks(p_workspace_id, p_query_embedding, p_limit)` and environment variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `runCloudIsolationCheck(): Promise<{ workspaceAFileName: string; workspaceBFileName: string; returnedFileNames: string[] }>`.

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, expect, it } from 'vitest';
import { runCloudIsolationCheck } from './cloudIsolation';

describe('cloud workspace isolation', () => {
  it(
    'does not return another workspace file from match_spike_chunks',
    async () => {
      const report = await runCloudIsolationCheck();
      expect(report.returnedFileNames).toEqual([report.workspaceAFileName]);
      expect(report.returnedFileNames).not.toContain(report.workspaceBFileName);
    },
    30_000
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @knowledge-base/search-spike exec vitest run src/cloud-isolation.test.ts
```

Expected: FAIL because `./cloudIsolation` does not exist.

- [ ] **Step 3: Implement the minimal cloud check**

Create `apps/search-spike/src/cloudIsolation.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface MatchRow {
  file_name: string;
}

export interface CloudIsolationReport {
  workspaceAFileName: string;
  workspaceBFileName: string;
  returnedFileNames: string[];
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: path.join(repoRoot, '.env.local') });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function vectorLiteral(): string {
  return `[${Array.from({ length: 384 }, () => 0.1).join(',')}]`;
}

export async function runCloudIsolationCheck(): Promise<CloudIsolationReport> {
  const chunkIds = [randomUUID(), randomUUID()];
  const workspaceIds = [randomUUID(), randomUUID()];
  const fileIds = [randomUUID(), randomUUID()];
  const runId = randomUUID();
  const workspaceAFileName = `workspace-a-${runId}.pdf`;
  const workspaceBFileName = `workspace-b-${runId}.pdf`;
  const embedding = vectorLiteral();
  const client = createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    const { error: insertError } = await client.from('spike_chunks').insert([
      {
        id: chunkIds[0],
        workspace_id: workspaceIds[0],
        file_id: fileIds[0],
        file_name: workspaceAFileName,
        content: 'workspace A synthetic isolation row',
        source_location: { kind: 'page', label: '第 1 页' },
        embedding
      },
      {
        id: chunkIds[1],
        workspace_id: workspaceIds[1],
        file_id: fileIds[1],
        file_name: workspaceBFileName,
        content: 'workspace B synthetic isolation row',
        source_location: { kind: 'page', label: '第 1 页' },
        embedding
      }
    ]);
    if (insertError) throw insertError;

    const { data, error: matchError } = await client.rpc(
      'match_spike_chunks',
      {
        p_workspace_id: workspaceIds[0],
        p_query_embedding: embedding,
        p_limit: 10
      }
    );
    if (matchError) throw matchError;

    return {
      workspaceAFileName,
      workspaceBFileName,
      returnedFileNames: (data as MatchRow[]).map((row) => row.file_name)
    };
  } finally {
    const { error: cleanupError } = await client
      .from('spike_chunks')
      .delete()
      .in('id', chunkIds);
    if (cleanupError) throw cleanupError;
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @knowledge-base/search-spike exec vitest run src/cloud-isolation.test.ts
```

Expected: one test passes and the process exits 0.

- [ ] **Step 5: Run the complete Phase 0 gate**

Run:

```bash
supabase migration list
pnpm --filter @knowledge-base/search-spike evaluate
pnpm test
pnpm typecheck
pnpm --dir apps/client tauri build --debug
```

Expected: migration versions match, 6 Vitest tests pass, type checking and the Mac build exit 0, and Recall@5 remains at least 0.8.

- [ ] **Step 6: Update the gate documentation from fresh evidence**

Replace the required linked pgTAP command with the cloud Vitest test, record the exact migration/evaluation/test/build results, and change `decision.md` to `GO` only if Step 5 fully passes. Keep `supabase/tests/search_spike_test.sql` documented as optional.

- [ ] **Step 7: Verify and push the requested main commit**

Run:

```bash
git diff --check
git status --short
git add README.md apps/search-spike docs fixtures supabase pnpm-lock.yaml pnpm-workspace.yaml validation/phase-0
git commit -m "feat: add phase zero cloud search validation"
git push origin main
```

Expected: the commit contains no ignored credentials or model cache, and `origin/main` advances to the new commit.
