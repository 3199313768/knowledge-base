# Phase 1 Cloud Foundation and Security Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production-shaped Supabase schema, passwordless authentication contract, team membership boundary, invitation flow, private file storage, processing state machine, audit trail, and real-cloud isolation gate required before any real team data is imported.

**Architecture:** Keep Supabase Auth responsible for email OTP sessions, PostgreSQL/RLS responsible for every team authorization decision, Storage responsible for private originals, and a dedicated `@knowledge-base/cloud-foundation` package responsible for real-cloud verification with ordinary user JWTs. Client-facing mutations use narrowly scoped database functions; direct writes to protected tables remain revoked. Phase 0 search artifacts stay available only to `service_role` and are not extended into the product schema.

**Tech Stack:** Supabase CLI 2.111.0, hosted Supabase Auth/PostgreSQL 17/Storage/Edge Functions, SQL migrations, pgvector 384, TypeScript 7, `@supabase/supabase-js` 2.112.0, Vitest 4.1.10, Deno 2 for Edge Functions, Resend HTTP API for team-invitation email.

## Global Constraints

- Implement against a dedicated Supabase development project only; never point migrations, tests, or service-role credentials at production.
- Preserve the frozen product specification in `docs/requirements/knowledge-base-app-design.md`; scope changes require a new product review.
- Authentication is email OTP only in product UI: six digits, current Supabase expiry 3,600 seconds, no password screens or reset flow.
- One account can create or join multiple workspaces; every operation is scoped to one current workspace and authorized from `MEMBERSHIP`, never from client state.
- Roles remain exactly `admin` and `member`; every workspace must retain at least one admin.
- Invitations last seven days, require the same authenticated email, and a single invitation record cannot be reused.
- Supported uploaded files are PDF, DOCX, PPTX, XLSX, JPG/JPEG, PNG, and HEIC/HEIF; the decimal file-size ceiling is 100,000,000 bytes.
- Web URLs create processing records without a Storage object; webpage snapshotting belongs to Phase 2.
- Original files live in one private `documents` bucket. Download URLs expire after 60 seconds. Supabase signed upload tokens are valid for two hours and must use `upsert: false`.
- File contents, images, and search text must not be sent to third-party generative AI services.
- Service-role credentials are allowed only in trusted test setup, cleanup, Edge Functions, and later workers; permission assertions must use ordinary authenticated clients.
- Real-cloud tests generate unique IDs/emails, track every created resource, and clean only those resources in `finally`.
- Keep local unit tests hermetic. Cloud writes run only through explicit `test:cloud` or `verify:phase-1` commands.
- Do not run `git add`, `git commit`, push, deploy, link a new project, install Deno, or create a Resend account/key without explicit user authorization. Each task ends at a reviewer checkpoint instead of an automatic commit.

## Official References

- [Supabase passwordless email login](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase database testing](https://supabase.com/docs/guides/database/testing)
- [Supabase Edge Function email example](https://supabase.com/docs/guides/functions/examples/send-emails)

## Planned File Structure

```text
.
├── .env.example
├── package.json
├── apps/
│   ├── client/package.json
│   ├── search-spike/
│   │   ├── package.json
│   │   └── src/
│   │       ├── embed.external.test.ts
│   │       ├── evaluate.cloud.test.ts
│   │       └── cloud-isolation.cloud.test.ts
│   └── cloud-foundation/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── env.ts
│           ├── testHarness.ts
│           ├── workspace-access.cloud.test.ts
│           ├── invitations.cloud.test.ts
│           ├── files-storage.cloud.test.ts
│           └── processing-state.cloud.test.ts
├── packages/contracts/package.json
├── supabase/
│   ├── config.toml
│   ├── functions/
│   │   ├── _shared/invitationEmail.ts
│   │   └── send-workspace-invitation/
│   │       ├── index.ts
│   │       └── index.test.ts
│   ├── migrations/
│   │   ├── 20260807000100_phase1_schema.sql
│   │   ├── 20260807000200_phase1_workspace_security.sql
│   │   ├── 20260807000300_phase1_invitations.sql
│   │   ├── 20260807000400_phase1_files_storage.sql
│   │   └── 20260807000500_phase1_processing_audit.sql
│   └── tests/phase1_schema_test.sql
└── validation/phase-1/
    └── decision.md
```

`apps/cloud-foundation` owns cloud-only acceptance tests and never ships in the client. SQL files are ordered so a blank project can replay schema before policies and policies before behavior-specific RPCs.

---

### Task 1: Separate Hermetic Tests from Explicit Cloud Gates

**Files:**

- Create: `.env.example`
- Modify: `package.json`
- Modify: `apps/client/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `apps/search-spike/package.json`
- Rename: `apps/search-spike/src/evaluate.test.ts` → `apps/search-spike/src/embed.external.test.ts`
- Rename: `apps/search-spike/src/cloud-isolation.test.ts` → `apps/search-spike/src/cloud-isolation.cloud.test.ts`
- Create: `apps/search-spike/src/evaluate.cloud.test.ts`
- Create: `apps/cloud-foundation/package.json`
- Create: `apps/cloud-foundation/tsconfig.json`
- Create: `apps/cloud-foundation/vitest.config.ts`
- Create: `apps/cloud-foundation/src/env.ts`
- Create: `apps/cloud-foundation/src/testHarness.ts`

**Interfaces:**

- Consumes: existing `.env.local` keys `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `loadCloudTestEnv(): CloudTestEnv`, `createCloudHarness(): CloudHarness`, `createWorkspace(client,harness,name?): Promise<string>`, `CloudHarness.createActor(label): Promise<TestActor>`, `CloudHarness.cleanup(): Promise<void>`, and explicit root scripts `test`, `test:cloud`, `verify:phase-1`.

- [ ] **Step 1: Write the environment contract**

Create `.env.example` without real values:

```dotenv
SUPABASE_ENVIRONMENT=development
SUPABASE_PROJECT_REF=replace-with-dedicated-development-project-ref
SUPABASE_URL=https://replace-with-project-ref.supabase.co
SUPABASE_ANON_KEY=replace-with-publishable-or-anon-key
SUPABASE_SERVICE_ROLE_KEY=replace-with-service-role-key
RESEND_API_KEY=replace-only-when-email-delivery-is-approved
INVITATION_FROM_EMAIL=KnowledgeBase <invite@example.com>
```

Implement `apps/cloud-foundation/src/env.ts`:

```ts
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: path.join(repoRoot, '.env.local') });

export interface CloudTestEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  projectRef: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadCloudTestEnv(): CloudTestEnv {
  if (required('SUPABASE_ENVIRONMENT') !== 'development') {
    throw new Error('Cloud tests require SUPABASE_ENVIRONMENT=development');
  }
  const projectRef = required('SUPABASE_PROJECT_REF');
  const url = required('SUPABASE_URL');
  if (new URL(url).hostname !== `${projectRef}.supabase.co`) {
    throw new Error('SUPABASE_URL does not match SUPABASE_PROJECT_REF');
  }
  return {
    url,
    projectRef,
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY')
  };
}
```

- [ ] **Step 2: Create the cloud package and serial Vitest configuration**

Use this package contract:

```json
{
  "name": "@knowledge-base/cloud-foundation",
  "private": true,
  "type": "module",
  "scripts": {
    "test:unit": "vitest run --config vitest.config.ts --passWithNoTests",
    "test:cloud": "vitest run --config vitest.config.ts src/**/*.cloud.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.112.0",
    "dotenv": "^17.4.2"
  },
  "devDependencies": {
    "@types/node": "^26.1.2",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

`vitest.config.ts` must keep shared-cloud mutation serial:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});
```

- [ ] **Step 3: Implement ordinary authenticated test actors**

`testHarness.ts` must use service role only to generate test users and magic-link token hashes, then exchange each hash through an anon client so all assertions run with a normal `authenticated` JWT:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { loadCloudTestEnv } from './env';

export interface TestActor {
  userId: string;
  email: string;
  client: SupabaseClient;
}

export interface CloudHarness {
  admin: SupabaseClient;
  createActor(label: string): Promise<TestActor>;
  trackWorkspace(id: string): void;
  cleanup(): Promise<void>;
}

export function createCloudHarness(): CloudHarness {
  const env = loadCloudTestEnv();
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const userIds = new Set<string>();
  const workspaceIds = new Set<string>();

  return {
    admin,
    async createActor(label) {
      const email = `kb-${label}-${randomUUID()}@example.invalid`;
      const { data: link, error: linkError } =
        await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (linkError) throw linkError;
      const client = createClient(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data: session, error: verifyError } = await client.auth.verifyOtp({
        token_hash: link.properties.hashed_token,
        type: 'magiclink'
      });
      if (verifyError || !session.user) {
        throw verifyError ?? new Error('Magic-link exchange returned no user');
      }
      userIds.add(session.user.id);
      return { userId: session.user.id, email, client };
    },
    trackWorkspace(id) {
      workspaceIds.add(id);
    },
    async cleanup() {
      for (const workspaceId of workspaceIds) {
        const { error } = await admin.from('workspaces').delete().eq('id', workspaceId);
        if (error) throw error;
      }
      for (const userId of userIds) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
      }
    }
  };
}

export async function createWorkspace(
  client: SupabaseClient,
  harness: CloudHarness,
  name = '测试团队'
): Promise<string> {
  const { data, error } = await client.rpc('create_workspace', { p_name: name });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('create_workspace returned no ID');
  harness.trackWorkspace(data);
  return data;
}
```

- [ ] **Step 4: Split the Phase 0 tests without changing their assertions**

Move only the normalized-vector test into `embed.external.test.ts`; it can initialize or download a model, so it is not a hermetic unit test. Move only the real evaluation test into `evaluate.cloud.test.ts`. Rename the workspace-isolation test with `.cloud.test.ts`. Set `apps/search-spike/package.json` scripts to:

```json
{
  "scripts": {
    "test:unit": "vitest run --passWithNoTests src/**/*.unit.test.ts",
    "test:model": "vitest run src/embed.external.test.ts",
    "test:cloud": "vitest run src/evaluate.cloud.test.ts src/cloud-isolation.cloud.test.ts",
    "typecheck": "tsc --noEmit",
    "evaluate": "tsx src/evaluate.ts"
  }
}
```

Add `test:unit` aliases to client and contracts, then set root scripts to:

```json
{
  "scripts": {
    "test": "pnpm -r --if-present test:unit",
    "test:cloud": "pnpm --filter @knowledge-base/cloud-foundation test:cloud",
    "test:phase0-model": "pnpm --filter @knowledge-base/search-spike test:model",
    "test:phase0-cloud": "pnpm --filter @knowledge-base/search-spike test:cloud",
    "typecheck": "pnpm -r typecheck",
    "verify:phase-1": "pnpm test && pnpm typecheck && pnpm test:cloud"
  }
}
```

- [ ] **Step 5: Verify the safe test boundary**

Run:

```bash
pnpm test
pnpm typecheck
git diff --check
git status --short
```

Expected: local tests and all TypeScript packages exit 0 without reading `.env.local` or calling Supabase; only intended files are modified. Do not run `test:cloud` in this task.

---

### Task 2: Create the Formal Phase 1 Schema and Lock Down Phase 0 Tables

**Files:**

- Modify: `supabase/config.toml`
- Create: `supabase/migrations/20260807000100_phase1_schema.sql`
- Create: `supabase/tests/phase1_schema_test.sql`

**Interfaces:**

- Consumes: `auth.users`, `extensions.vector(384)`, the frozen 100,000,000-byte limit.
- Produces: enums `workspace_role`, `invitation_status`, `file_source_type`, `file_version_status`, `processing_stage`, `processing_job_status`; tables `workspaces`, `memberships`, `workspace_invitations`, `files`, `file_versions`, `processing_jobs`, `content_chunks`, `devices`, `audit_events`; private `documents` bucket.

- [ ] **Step 1: Write schema assertions before the migration**

Create a pgTAP file that asserts the public entities, RLS flags, bucket privacy, and size limit. The core assertions must be explicit:

```sql
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
```

- [ ] **Step 2: Run the schema test and verify RED**

Run only on an approved disposable local stack or blank cloud branch:

```bash
supabase test db supabase/tests/phase1_schema_test.sql
```

Expected: FAIL because the Phase 1 tables and bucket do not exist. If Docker is unavailable, record the unavailable local gate and continue RED through the first focused cloud test after deployment; do not reinterpret an unstarted test as a pass.

- [ ] **Step 3: Configure the frozen file limit and OTP contract**

Change `supabase/config.toml` exactly:

```toml
[storage]
enabled = true
file_size_limit = "100MB"

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
secure_password_change = false
max_frequency = "1s"
otp_length = 6
otp_expiry = 3600
```

- [ ] **Step 4: Implement the schema migration**

The migration must use the following exact domain values and key constraints:

```sql
create extension if not exists vector with schema extensions;
create extension if not exists citext with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.workspace_role as enum ('admin', 'member');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.file_source_type as enum ('upload', 'web');
create type public.file_version_status as enum (
  'awaiting_upload', 'pending_processing', 'processing',
  'searchable', 'partially_searchable', 'failed'
);
create type public.processing_stage as enum ('validate', 'extract', 'ocr', 'chunk', 'embed', 'finalize', 'cleanup');
create type public.processing_job_status as enum ('pending', 'running', 'succeeded', 'failed');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email extensions.citext not null,
  role public.workspace_role not null default 'member' check (role = 'member'),
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);
create unique index workspace_invitations_one_pending
  on public.workspace_invitations (workspace_id, email)
  where status = 'pending';

create table public.files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  uploader_id uuid not null references auth.users(id),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 255),
  source_type public.file_source_type not null,
  current_version_id uuid,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table public.file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null,
  workspace_id uuid not null,
  created_by uuid not null references auth.users(id),
  storage_path text,
  original_url text,
  checksum text,
  mime_type text,
  size_bytes bigint,
  status public.file_version_status not null,
  error_code text,
  created_at timestamptz not null default now(),
  unique (id, file_id, workspace_id),
  foreign key (file_id, workspace_id)
    references public.files(id, workspace_id) on delete cascade,
  check (
    (storage_path is not null and original_url is null and checksum is not null
      and checksum ~ '^sha256:[0-9a-f]{64}$'
      and mime_type is not null and size_bytes between 1 and 100000000)
    or
    (storage_path is null and original_url is not null and checksum is null and size_bytes is null)
  )
);

alter table public.files add constraint files_current_version_fk
  foreign key (current_version_id)
  references public.file_versions(id) on delete set null;

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.file_versions(id) on delete cascade,
  stage public.processing_stage not null,
  status public.processing_job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, stage)
);

create table public.content_chunks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.file_versions(id) on delete cascade,
  content text not null,
  source_location jsonb not null,
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('macos', 'ios')),
  notification_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, notification_token)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index memberships_user_idx on public.memberships(user_id, workspace_id);
create index files_workspace_active_idx on public.files(workspace_id, updated_at desc) where deleted_at is null;
create index file_versions_file_idx on public.file_versions(file_id, created_at desc);
create index content_chunks_version_idx on public.content_chunks(version_id);
create index audit_events_workspace_idx on public.audit_events(workspace_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 100000000,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png', 'image/heic', 'image/heif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.files enable row level security;
alter table public.file_versions enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.content_chunks enable row level security;
alter table public.devices enable row level security;
alter table public.audit_events enable row level security;

alter table public.spike_chunks enable row level security;
revoke all on public.spike_chunks from anon, authenticated;
revoke execute on function public.match_spike_chunks(uuid, extensions.vector, integer)
  from public, anon, authenticated;
grant all on public.spike_chunks to service_role;
grant execute on function public.match_spike_chunks(uuid, extensions.vector, integer)
  to service_role;
```

- [ ] **Step 5: Apply only after inspecting the exact linked target**

Run read-only target checks first:

```bash
supabase projects list
supabase migration list
```

Verify the linked project ref equals `SUPABASE_PROJECT_REF`, then after explicit approval:

```bash
supabase db push --include-all
```

Expected: the new migration is applied only to the dedicated development project.

- [ ] **Step 6: Re-run schema checks and inspect the diff**

Run the available pgTAP gate plus:

```bash
supabase migration list
git diff --check
git status --short
```

Expected: local and remote migration histories include `20260807000100`; pgTAP reports 15 passing assertions when the local/branch runner is available; no credentials appear in Git status.

---
### Task 3: Enforce Workspace Membership and Admin Invariants

**Files:**

- Create: `supabase/migrations/20260807000200_phase1_workspace_security.sql`
- Create: `apps/cloud-foundation/src/workspace-access.cloud.test.ts`

**Interfaces:**

- Consumes: `workspaces`, `memberships`, `files`, `file_versions`, `processing_jobs`, `content_chunks`, `devices`, `audit_events`.
- Produces: private helpers `is_workspace_member(uuid)`, `is_workspace_admin(uuid)`, `can_manage_file(uuid)` and public RPCs `create_workspace(text)`, `rename_workspace(uuid,text)`, `set_workspace_member_role(uuid,uuid,workspace_role)`, `remove_workspace_member(uuid,uuid)`, `leave_workspace(uuid)`.

- [ ] **Step 1: Write the failing real-user authorization test**

Create a cloud test that proves the creator becomes admin, an outsider cannot read the workspace, and the last admin cannot leave:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCloudHarness, type CloudHarness } from './testHarness';

describe('workspace access', () => {
  let harness: CloudHarness;
  beforeEach(() => { harness = createCloudHarness(); });
  afterEach(async () => { await harness.cleanup(); });

  it('isolates outsiders and preserves one admin', async () => {
    const owner = await harness.createActor('owner');
    const outsider = await harness.createActor('outsider');
    const { data: workspaceId, error: createError } =
      await owner.client.rpc('create_workspace', { p_name: '测试团队' });
    expect(createError).toBeNull();
    harness.trackWorkspace(workspaceId);

    const { data: memberships } = await owner.client
      .from('memberships')
      .select('user_id, role')
      .eq('workspace_id', workspaceId);
    expect(memberships).toEqual([{ user_id: owner.userId, role: 'admin' }]);

    const { data: leakedRows } = await outsider.client
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId);
    expect(leakedRows).toEqual([]);

    const { error: leaveError } = await owner.client.rpc('leave_workspace', {
      p_workspace_id: workspaceId
    });
    expect(leaveError?.message).toContain('workspace must retain an admin');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run after Task 2 is deployed:

```bash
pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.config.ts src/workspace-access.cloud.test.ts
```

Expected: FAIL because `create_workspace` and `leave_workspace` do not exist.

- [ ] **Step 3: Add non-recursive authorization helpers**

Put security-definer helpers in the unexposed `private` schema, set an empty search path, and fully qualify every relation:

```sql
create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
  );
$$;

create or replace function private.can_manage_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.files f
    where f.id = p_file_id
      and f.deleted_at is null
      and (
        f.uploader_id = (select auth.uid())
        or private.is_workspace_admin(f.workspace_id)
      )
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public;
revoke all on function private.is_workspace_admin(uuid) from public;
revoke all on function private.can_manage_file(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;
grant execute on function private.can_manage_file(uuid) to authenticated;
```

- [ ] **Step 4: Add read policies and keep protected writes behind RPCs**

Grant only required reads, then create explicit policies:

```sql
grant select on public.workspaces, public.memberships, public.workspace_invitations,
  public.files, public.file_versions, public.processing_jobs,
  public.content_chunks, public.audit_events to authenticated;
grant select, insert, update, delete on public.devices to authenticated;

create policy workspaces_select_member on public.workspaces
for select to authenticated
using (private.is_workspace_member(id));

create policy memberships_select_member on public.memberships
for select to authenticated
using (private.is_workspace_member(workspace_id));

create policy files_select_member on public.files
for select to authenticated
using (deleted_at is null and private.is_workspace_member(workspace_id));

create policy file_versions_select_member on public.file_versions
for select to authenticated
using (
  private.is_workspace_member(workspace_id)
  and exists (
    select 1 from public.files f
    where f.id = file_id and f.deleted_at is null
  )
);

create policy processing_jobs_select_member on public.processing_jobs
for select to authenticated
using (
  exists (
    select 1 from public.file_versions v
    join public.files f on f.id = v.file_id
    where v.id = version_id
      and f.deleted_at is null
      and private.is_workspace_member(v.workspace_id)
  )
);

create policy content_chunks_select_current_member on public.content_chunks
for select to authenticated
using (
  exists (
    select 1 from public.file_versions v
    join public.files f on f.current_version_id = v.id
    where v.id = version_id
      and f.deleted_at is null
      and private.is_workspace_member(v.workspace_id)
  )
);

create policy audit_events_select_admin on public.audit_events
for select to authenticated
using (private.is_workspace_admin(workspace_id));

create policy devices_select_own on public.devices
for select to authenticated using (user_id = (select auth.uid()));
create policy devices_insert_own on public.devices
for insert to authenticated with check (user_id = (select auth.uid()));
create policy devices_update_own on public.devices
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy devices_delete_own on public.devices
for delete to authenticated using (user_id = (select auth.uid()));
```

- [ ] **Step 5: Add transactional workspace RPCs**

Every mutating function must be `security definer`, use `set search_path = ''`, lock the workspace row before admin-count checks, and write an audit event. The creator function is:

```sql
create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if char_length(btrim(p_name)) not between 1 and 100 then
    raise exception 'workspace name must contain 1 to 100 characters';
  end if;
  insert into public.workspaces (name, created_by)
  values (btrim(p_name), v_user_id)
  returning id into v_workspace_id;
  insert into public.memberships (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'admin');
  insert into public.audit_events (workspace_id, actor_id, action, target_type, target_id)
  values (v_workspace_id, v_user_id, 'workspace.created', 'workspace', v_workspace_id);
  return v_workspace_id;
end;
$$;
```

Implement the remaining signatures with these exact rules:

```sql
public.rename_workspace(p_workspace_id uuid, p_name text) returns void
-- caller must be admin; trim and enforce 1..100 chars; audit workspace.renamed

public.set_workspace_member_role(
  p_workspace_id uuid, p_user_id uuid, p_role public.workspace_role
) returns void
-- caller must be admin; lock workspace; reject demoting the final admin;
-- audit membership.role_changed

public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid) returns void
-- caller must be admin; lock workspace; reject removing the final admin;
-- delete membership; audit membership.removed

public.leave_workspace(p_workspace_id uuid) returns void
-- lock workspace; reject final-admin departure; delete caller membership;
-- audit membership.left
```

Revoke all function execution from `public` and `anon`; grant only to `authenticated`.

- [ ] **Step 6: Verify all membership edges**

Expand the test with a second member and assert: outsider cannot rename; member cannot promote; admin can promote; final admin cannot be demoted/removed; once removed, the user gets zero rows from the workspace and existing authenticated sessions no longer authorize access.

Run:

```bash
pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.config.ts src/workspace-access.cloud.test.ts
git diff --check
git status --short
```

Expected: all workspace-access tests pass using ordinary JWTs; cleanup removes only generated workspaces/users.

---

### Task 4: Implement Seven-Day Invitations and Email Delivery

**Files:**

- Create: `supabase/migrations/20260807000300_phase1_invitations.sql`
- Create: `apps/cloud-foundation/src/invitations.cloud.test.ts`
- Create: `supabase/functions/_shared/invitationEmail.ts`
- Create: `supabase/functions/send-workspace-invitation/index.ts`
- Create: `supabase/functions/send-workspace-invitation/index.test.ts`

**Interfaces:**

- Consumes: authenticated email from `auth.jwt()`, workspace admin helper, `workspace_invitations`, Resend secrets.
- Produces: RPCs `create_workspace_invitation(uuid,citext)`, `revoke_workspace_invitation(uuid)`, `list_my_pending_invitations()`, `accept_workspace_invitation(uuid)` and Edge Function `send-workspace-invitation` accepting `{ workspaceId: string; email: string }`.

- [ ] **Step 1: Write invitation lifecycle tests first**

The cloud test must cover acceptance, email mismatch, revoke, expiration, resend invalidation, and duplicate acceptance. Start with this acceptance case:

```ts
it('accepts only for the authenticated invited email', async () => {
  const owner = await harness.createActor('owner');
  const invitee = await harness.createActor('invitee');
  const wrongUser = await harness.createActor('wrong');
  const workspaceId = await createWorkspace(owner.client, harness);

  const { data: invitationId, error: inviteError } = await owner.client.rpc(
    'create_workspace_invitation',
    { p_workspace_id: workspaceId, p_email: invitee.email }
  );
  expect(inviteError).toBeNull();

  const { error: wrongError } = await wrongUser.client.rpc(
    'accept_workspace_invitation',
    { p_invitation_id: invitationId }
  );
  expect(wrongError?.message).toContain('invitation email does not match');

  const { error: acceptError } = await invitee.client.rpc(
    'accept_workspace_invitation',
    { p_invitation_id: invitationId }
  );
  expect(acceptError).toBeNull();

  const { data: membership } = await invitee.client
    .from('memberships')
    .select('role')
    .eq('workspace_id', workspaceId)
    .single();
  expect(membership?.role).toBe('member');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.config.ts src/invitations.cloud.test.ts
```

Expected: FAIL because invitation RPCs do not exist.

- [ ] **Step 3: Implement invitation RPCs transactionally**

Use `lower(auth.jwt() ->> 'email')` only for the authenticated email and read `auth.users` only inside security-definer functions. The create function must invalidate an existing pending row before inserting a new seven-day record:

```sql
create or replace function public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email extensions.citext
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email extensions.citext := lower(btrim(p_email::text))::extensions.citext;
  v_id uuid;
begin
  if not private.is_workspace_admin(p_workspace_id) then
    raise exception 'workspace admin required';
  end if;
  if v_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid invitation email';
  end if;
  if exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = p_workspace_id and lower(u.email) = lower(v_email::text)
  ) then
    raise exception 'user is already a workspace member';
  end if;
  update public.workspace_invitations
  set status = 'revoked', revoked_at = now()
  where workspace_id = p_workspace_id and email = v_email and status = 'pending';
  insert into public.workspace_invitations (
    workspace_id, email, invited_by, expires_at
  ) values (p_workspace_id, v_email, v_actor, now() + interval '7 days')
  returning id into v_id;
  insert into public.audit_events (workspace_id, actor_id, action, target_type, target_id)
  values (p_workspace_id, v_actor, 'invitation.created', 'invitation', v_id);
  return v_id;
end;
$$;
```

Implement the other RPCs with exact behavior:

```sql
public.revoke_workspace_invitation(p_invitation_id uuid) returns void
-- admin of the invitation workspace; pending only; set revoked/revoked_at; audit

public.list_my_pending_invitations()
returns table(id uuid, workspace_id uuid, workspace_name text, expires_at timestamptz)
-- match lower(email) to lower(auth.jwt()->>'email'); pending and expires_at > now()

public.accept_workspace_invitation(p_invitation_id uuid) returns uuid
-- lock invitation row FOR UPDATE; reject non-pending, expired, revoked, accepted,
-- or mismatched email; insert member ON CONFLICT DO NOTHING; mark accepted once;
-- set accepted_by/accepted_at; audit; return workspace_id
```

Create select policies so admins can list invitations for their workspace and an invitee can see only their own unexpired pending invitations. Direct insert/update/delete remains revoked.

- [ ] **Step 4: Write the email adapter as a pure unit**

`invitationEmail.ts` must accept an injected `fetch` so no unit test sends mail:

```ts
export interface InvitationEmail {
  to: string;
  workspaceName: string;
  expiresAt: string;
}

export async function sendInvitationEmail(
  input: InvitationEmail,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('INVITATION_FROM_EMAIL');
  if (!apiKey || !from) throw new Error('Invitation email secrets are not configured');
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `你已被邀请加入 ${input.workspaceName}`,
      text: `请使用此邮箱打开 KnowledgeBase 并登录，在 ${input.expiresAt} 前接受团队邀请。`
    })
  });
  if (!response.ok) throw new Error(`Invitation email failed: ${response.status}`);
}
```

Unit-test one 200 response and one 500 response with a fake fetch. Never print the recipient, API key, or response body.

- [ ] **Step 5: Implement the authenticated Edge Function**

`send-workspace-invitation/index.ts` must:

1. Reject non-POST requests.
2. Build a user-scoped Supabase client from the incoming `Authorization` header.
3. Call `auth.getUser()` and reject missing users.
4. Call `create_workspace_invitation`; the RPC verifies admin authority.
5. Read only `workspace.name` and the returned invitation expiry.
6. Send the email through `sendInvitationEmail`.
7. Return `{ invitationId }` without returning the email body or secrets.

If email delivery fails, leave the pending invitation visible to the admin so “resend” can explicitly replace it; return HTTP 502 and record no false delivery success.

- [ ] **Step 6: Verify unit, database, and approved live email paths separately**

Run unit tests after Deno installation is explicitly approved:

```bash
deno test --allow-env supabase/functions/send-workspace-invitation/index.test.ts
```

Run database behavior:

```bash
pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.config.ts src/invitations.cloud.test.ts
```

Only after Resend setup and deployment approval, set secrets, deploy the function, and send one invitation to an approved test inbox. Record unit/database/live-email results separately; a passing mocked email test is not live delivery evidence.

---

### Task 5: Add Private Storage and Upload Preparation Contracts

**Files:**

- Create: `supabase/migrations/20260807000400_phase1_files_storage.sql`
- Create: `apps/cloud-foundation/src/files-storage.cloud.test.ts`

**Interfaces:**

- Consumes: private `documents` bucket, `can_manage_file`, authenticated user identity.
- Produces: RPCs `prepare_file_upload(uuid,text,text,bigint,text)`, `prepare_file_version_upload(uuid,text,bigint,text)`, `prepare_web_import(uuid,text,text)`, `mark_upload_complete(uuid)`, `soft_delete_file(uuid)`; Storage path `{workspace_id}/{file_id}/{version_id}/source.{extension}`.

- [ ] **Step 1: Write cross-team file and Storage tests first**

Create two workspaces with ordinary authenticated clients. Assert that a member can prepare/upload/download within workspace A, cannot create a signed URL for workspace B, cannot manage another uploader's file, and an admin can. Include this exact signed URL boundary:

```ts
const { data: prepared, error: prepareError } = await memberA.client.rpc(
  'prepare_file_upload',
  {
    p_workspace_id: workspaceA,
    p_display_name: '报价.pdf',
    p_mime_type: 'application/pdf',
    p_size_bytes: 12,
    p_checksum: `sha256:${crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')}`
  }
);
expect(prepareError).toBeNull();
const preparedRow = prepared?.[0];
expect(preparedRow?.outcome).toBe('created');

const { data: signedUpload, error: signError } = await memberA.client.storage
  .from('documents')
  .createSignedUploadUrl(preparedRow!.storage_path, { upsert: false });
expect(signError).toBeNull();

const { data: outsiderUrl } = await outsider.client.storage
  .from('documents')
  .createSignedUrl(preparedRow!.storage_path, 60);
expect(outsiderUrl).toBeNull();
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.config.ts src/files-storage.cloud.test.ts
```

Expected: FAIL because preparation RPCs and Storage policies do not exist.

- [ ] **Step 3: Add exact MIME and extension helpers**

Create private immutable helpers that reject old Office and unsupported formats:

```sql
create or replace function private.extension_for_mime(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mime
    when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heic'
    else null
  end;
$$;
```

- [ ] **Step 4: Implement upload preparation without automatic overwrite**

`prepare_file_upload` returns this stable shape:

```sql
returns table (
  outcome text,
  file_id uuid,
  version_id uuid,
  storage_path text,
  duplicate_file_id uuid
)
```

Rules:

1. Require membership in `p_workspace_id`.
2. Validate trimmed display name, supported MIME, `1..100000000` bytes, and lowercase checksum format `^sha256:[0-9a-f]{64}$` for both tests and production clients.
3. Acquire `pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_checksum, 0))`, then check versions belonging to non-deleted files in the workspace. If the checksum already exists, return `outcome='duplicate'` and the existing logical file ID without inserting rows. The transaction lock prevents two concurrent RPC calls from inserting the same active content; deleted files do not block a later re-import.
4. Otherwise create `files` plus `file_versions(status='awaiting_upload')`, generate the ID-only Storage path, audit `file.created`, and return `outcome='created'`.
5. Never use Storage upsert.

`prepare_file_version_upload` uses the same validation, requires `private.can_manage_file(p_file_id)`, creates a new version without changing `current_version_id`, and returns `duplicate` rather than overwriting when the checksum already exists.

`prepare_web_import` requires membership, validates an absolute `https:` URL, creates a web file/version with `status='pending_processing'`, creates the first `validate` job, and writes no Storage object.

- [ ] **Step 5: Implement Storage RLS from the first path segment**

The path begins with the workspace UUID. Policies must additionally confirm a matching prepared version row:

```sql
create policy documents_insert_prepared_member on storage.objects
for insert to authenticated
with check (
  bucket_id = 'documents'
  and private.is_workspace_member(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1 from public.file_versions v
    where v.storage_path = name
      and v.workspace_id = ((storage.foldername(name))[1])::uuid
      and v.created_by = (select auth.uid())
      and v.status = 'awaiting_upload'
  )
);

create policy documents_select_member on storage.objects
for select to authenticated
using (
  bucket_id = 'documents'
  and private.is_workspace_member(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1 from public.file_versions v
    join public.files f on f.id = v.file_id
    where v.storage_path = name and f.deleted_at is null
  )
);
```

Do not add authenticated `UPDATE` or `DELETE` policies. Physical replacement/deletion belongs to trusted workers; client updates always create a new path/version.

- [ ] **Step 6: Implement upload completion and soft deletion**

`mark_upload_complete(p_version_id)` must verify the caller created the version or is a workspace admin, lock the version, require `awaiting_upload`, verify the object exists in `storage.objects`, set `pending_processing`, and insert the `validate` job. `soft_delete_file(p_file_id)` must require uploader-or-admin authority, set `deleted_at/deleted_by`, make reads/search disappear immediately, enqueue one `cleanup` job for every version of that file, and audit `file.deleted`.

- [ ] **Step 7: Verify file ownership, duplicate, size, type, and URL gates**

Add assertions for exact duplicate, same filename/different checksum, unsupported DOC MIME, 100,000,001 bytes, HTTP (non-HTTPS) URL, failed new version retaining the current version, and removed-member denial.

Run:

```bash
pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.config.ts src/files-storage.cloud.test.ts
git diff --check
git status --short
```

Expected: all file and Storage assertions pass; Storage cleanup uses service role and only the generated path prefix.

---

### Task 6: Enforce Processing Transitions, Atomic Version Switches, Audit, and Devices

**Files:**

- Create: `supabase/migrations/20260807000500_phase1_processing_audit.sql`
- Create: `apps/cloud-foundation/src/processing-state.cloud.test.ts`

**Interfaces:**

- Consumes: `file_versions`, `files.current_version_id`, `processing_jobs`, `audit_events`, ordinary uploader/admin clients, trusted service-role worker client.
- Produces: RPCs `retry_file_version(uuid)`, `claim_processing_job()`, `complete_processing_job(uuid,boolean,text)`, `finalize_file_version(uuid,file_version_status,text)` and immutable audit/device boundaries.

- [ ] **Step 1: Write the atomic-version regression test**

Add task-local helpers with these exact signatures:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

interface PreparedVersion {
  file_id: string;
  version_id: string;
  storage_path: string;
}

async function createUploadedVersion(
  client: SupabaseClient,
  workspaceId: string,
  label: string
): Promise<PreparedVersion>;

async function createVersionUpdate(
  client: SupabaseClient,
  fileId: string,
  label: string
): Promise<PreparedVersion>;

async function claimVersionAsService(
  admin: SupabaseClient,
  expectedVersionId: string
): Promise<void>;

async function finalizeAsService(
  admin: SupabaseClient,
  versionId: string,
  status: 'searchable' | 'partially_searchable' | 'failed',
  errorCode?: string
): Promise<void>;

async function currentVersion(
  client: SupabaseClient,
  fileId: string
): Promise<string | null>;
```

`createUploadedVersion` and `createVersionUpdate` must prepare a version, create a signed upload URL, upload a small synthetic PDF body through `uploadToSignedUrl`, and call `mark_upload_complete`. `claimVersionAsService` calls `claim_processing_job`, verifies the returned version ID, and leaves the version in `processing`. `finalizeAsService` calls the service-role-only `finalize_file_version`. None of these helpers may update tables directly.

Then create one searchable version, a failed replacement, and a partially searchable replacement to prove atomic switching:

```ts
it('keeps the old searchable version until a new version succeeds', async () => {
  const actor = await harness.createActor('uploader');
  const workspaceId = await createWorkspace(actor.client, harness);
  const first = await createUploadedVersion(actor.client, workspaceId, 'first');
  await claimVersionAsService(harness.admin, first.version_id);
  await finalizeAsService(harness.admin, first.version_id, 'searchable');

  const second = await createVersionUpdate(actor.client, first.file_id, 'second');
  await claimVersionAsService(harness.admin, second.version_id);
  await finalizeAsService(harness.admin, second.version_id, 'failed', 'extract_failed');
  expect(await currentVersion(actor.client, first.file_id)).toBe(first.version_id);

  const third = await createVersionUpdate(actor.client, first.file_id, 'third');
  await claimVersionAsService(harness.admin, third.version_id);
  await finalizeAsService(harness.admin, third.version_id, 'partially_searchable');
  expect(await currentVersion(actor.client, first.file_id)).toBe(third.version_id);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.config.ts src/processing-state.cloud.test.ts
```

Expected: FAIL because worker transition RPCs do not exist.

- [ ] **Step 3: Encode the only allowed file-version transitions**

Create a private function with an explicit matrix:

```sql
create or replace function private.is_valid_file_version_transition(
  p_from public.file_version_status,
  p_to public.file_version_status
) returns boolean
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
```

`uploading` is client-observed progress and is intentionally not a database enum value or durable server transition target.

- [ ] **Step 4: Implement trusted job claiming and completion**

`claim_processing_job()` is granted only to `service_role`; it must select one available pending job with `FOR UPDATE SKIP LOCKED`, mark it running, increment attempts, set the version to `processing` when appropriate, and return this exact shape:

```sql
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
```

`complete_processing_job(p_job_id uuid,p_succeeded boolean,p_error_code text) returns void` is service-role-only. Success marks the stage succeeded; failure records only a bounded error code (maximum 100 characters), never exception bodies or document text.

`finalize_file_version(p_version_id uuid,p_status public.file_version_status,p_error_code text) returns void` is service-role-only and accepts only `searchable`, `partially_searchable`, or `failed`. Its critical transaction is:

```sql
if p_status in ('searchable', 'partially_searchable') then
  update public.file_versions
  set status = p_status, error_code = null
  where id = p_version_id;

  update public.files f
  set current_version_id = p_version_id, updated_at = now()
  from public.file_versions v
  where v.id = p_version_id and f.id = v.file_id and f.deleted_at is null;
else
  update public.file_versions
  set status = 'failed', error_code = left(p_error_code, 100)
  where id = p_version_id;
end if;
```

Never clear or replace `files.current_version_id` on failure.

- [ ] **Step 5: Add uploader/admin manual retry**

`retry_file_version(p_version_id)` must require `private.can_manage_file(file_id)`, lock the version, accept only `failed`, reset failed jobs to pending with `available_at=now()`, clear the bounded error code, set `pending_processing`, and audit `file_version.retry_requested`. It must not create duplicate `(version_id, stage)` jobs.

- [ ] **Step 6: Protect audit events and verify device ownership**

Revoke all authenticated insert/update/delete privileges on `audit_events`; only security-definer business RPCs and service-role workers append events. Keep device mutations user-owned through Task 3 policies. Add tests that a member cannot forge an audit event, a non-admin cannot read audit events, an admin can read them, and one user cannot read/update another user's device token.

- [ ] **Step 7: Verify transitions and redaction**

Test invalid transitions (`searchable → processing`, `awaiting_upload → searchable`), concurrent claim uniqueness, retry idempotency, old-version preservation, partial-success switching, audit append-only behavior, and error-code truncation/no document text.

Run:

```bash
pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.config.ts src/processing-state.cloud.test.ts
git diff --check
git status --short
```

Expected: the focused processing suite passes; current-version assertions prove atomic behavior.

---

### Task 7: Build the Complete Phase 1 Security Gate

**Files:**

- Modify: `apps/cloud-foundation/src/workspace-access.cloud.test.ts`
- Modify: `apps/cloud-foundation/src/invitations.cloud.test.ts`
- Modify: `apps/cloud-foundation/src/files-storage.cloud.test.ts`
- Modify: `apps/cloud-foundation/src/processing-state.cloud.test.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: every Phase 1 migration/RPC/policy and the Task 1 explicit cloud command.
- Produces: one deterministic `pnpm verify:phase-1` gate with separate local and cloud evidence.

- [ ] **Step 1: Complete the actor/workspace matrix**

Every cloud run must create:

```text
workspace A: adminA + memberA
workspace B: adminB
outsider: authenticated user with no membership in A or B
```

Use one unique run ID. Store all workspace IDs, auth user IDs, invitation IDs, file IDs, version IDs, and Storage paths in the harness. Cleanup order is Storage objects → workspaces (cascade domain rows) → auth users.

- [ ] **Step 2: Cover every frozen permission edge**

The combined suite must assert all of the following with ordinary JWTs:

```text
PASS: adminA/memberA read workspace A, active files, versions, status
DENY: adminB/outsider read workspace A rows or signed download URLs
DENY: memberA changes roles, removes members, renames workspace
PASS: adminA promotes/demotes/removes non-final members
DENY: final admin leaves, is demoted, or is removed
DENY: removed member reads, uploads, signs URLs, or receives device-scoped access
PASS: member manages own file; DENY: member manages another uploader's file
PASS: admin manages any file in the workspace
DENY: direct authenticated writes to memberships, invitations, files,
      file_versions, processing_jobs, content_chunks, audit_events
DENY: anon reads every Phase 1 table and Phase 0 spike table
DENY: cross-workspace search/chunk read, update, delete, upload, download
PASS: invitation accepts once for matching email before seven-day expiry
DENY: wrong email, revoked invite, expired invite, duplicate acceptance
PASS: web import creates no Storage object
PASS: duplicate checksum returns existing file without new version
PASS: failed replacement keeps old current version
PASS: successful/partial replacement atomically switches current version
```

- [ ] **Step 3: Make cleanup failure visible without masking the primary failure**

Update the harness so test bodies preserve the first error and cleanup errors are aggregated. Use `Promise.allSettled` per resource class and throw an `AggregateError` only after all cleanup attempts. Never broaden cleanup predicates beyond tracked IDs/path prefixes.

- [ ] **Step 4: Document exact test layers**

Update README commands and boundaries:

```bash
# Hermetic local tests; no Supabase access
pnpm test
pnpm typecheck

# Dedicated development project only; creates and cleans synthetic data
pnpm test:cloud

# Phase 1 required gate
pnpm verify:phase-1
```

Document that `test:phase0-cloud` is historical Spike verification, not a Phase 1 or future product gate. Document required env names without values and state that `service_role` is setup/cleanup only.

- [ ] **Step 5: Run the complete gate from a clean shell**

Run:

```bash
pnpm test
pnpm typecheck
pnpm test:cloud
git diff --check
git status --short
```

Expected: local tests/typechecks exit 0; all cloud suites pass serially; no synthetic rows/objects/users remain; only intended source, migration, test, README, validation, and plan files are modified.

Do not summarize this as `pnpm test` passing if only focused suites were run. Record counts for local unit tests and cloud integration tests separately.

---

### Task 8: Prove Blank-Project Rebuild and Write the Phase 1 Decision

**Files:**

- Create: `validation/phase-1/decision.md`
- Modify: `docs/requirements/knowledge-base-implementation-roadmap.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: ordered migrations `20260804000100` through `20260807000500`, the complete Phase 1 gate, an approved disposable Supabase Branch or blank development project.
- Produces: evidence-backed Phase 1 `GO`/`NO-GO` and the exact input boundary for Phase 2.

- [ ] **Step 1: Resolve and record the disposable target before mutation**

Use an explicitly approved Supabase Branch or blank project whose ref is different from the long-lived development project. After the user supplies the approved ref as a shell-local variable, validate it without writing it to a file:

```bash
test -n "$PHASE1_REBUILD_PROJECT_REF"
supabase projects list
```

Stop if the resolved target is production, contains non-synthetic data, or is not explicitly approved.

- [ ] **Step 2: Replay every migration into the blank target**

After approval:

```bash
supabase link --project-ref "$PHASE1_REBUILD_PROJECT_REF"
supabase migration list
supabase db push --include-all
supabase migration list
```

Expected: all ordered migrations apply without manual dashboard SQL; local and remote histories match. Do not clean or alter the original linked development project while proving rebuild.

- [ ] **Step 3: Run schema and ordinary-user gates against the rebuilt target**

Temporarily point only the current shell's development env variables at the disposable target, then run:

```bash
pnpm test:cloud
```

Expected: the same actor/workspace/storage/invitation/state matrix passes on a blank rebuild and leaves no synthetic resources.

- [ ] **Step 4: Restore and verify the original development link**

Relink the original dedicated development ref, then run read-only verification:

```bash
supabase migration list
git status --short
```

Expected: the original project link is restored; repository source changes are preserved; no environment or credential file is tracked.

- [ ] **Step 5: Write an evidence-only Phase 1 decision**

Create `validation/phase-1/decision.md` with these exact sections:

```markdown
# Phase 1 Decision

## Target isolation

## Migration rebuild

## Authentication and workspace authorization

## Invitation lifecycle and email delivery

## Private Storage

## File state machine and audit

## Verification summary

## Remaining limitations

## Decision
```

For each section record date, target type (never secret keys), exact command, exit code, test count, and observed result. Record live email separately from mocked email. Record local Docker/pgTAP as unavailable if it was not run; do not convert unavailable into passing.

Set `**Decision:** GO` only if all of these are true:

1. Blank-project migration rebuild succeeds.
2. Ordinary-user cross-team read/search/update/delete/upload/download checks pass.
3. Last-admin and invitation lifecycle checks pass.
4. Private Storage signed upload/download checks pass.
5. Failed replacement preserves the old current version.
6. Local unit/type gates and real-cloud integration gates exit 0.
7. No synthetic resources or secrets remain.

Otherwise set `**Decision:** NO-GO` and list the exact failed or unavailable mandatory gate.

- [ ] **Step 6: Update the roadmap only from the decision**

If and only if the decision is `GO`, mark Phase 1 complete in the roadmap and identify Phase 2's next action as a separate file-processing and hybrid-search design/plan cycle. Do not implement parsers, OCR, embeddings, search ranking, or client UI in this Phase 1 branch.

- [ ] **Step 7: Final reviewer checkpoint**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; the diff matches Phase 1 only. Do not stage or commit until the user explicitly requests it.

---


## Plan Completion Criteria

This plan is complete when the Phase 1 decision contains fresh evidence for schema rebuild, normal-user RLS, private Storage, invitation lifecycle, state transitions, cleanup, and all local gates. A design review, SQL inspection, service-role-only test, or historical Phase 0 result cannot substitute for those observations.

## Frozen-Spec Coverage Check

- Email OTP session contract: Tasks 1–2; Mac/iPhone login UI and current-device logout remain Phase 3.
- Multi-workspace roles, last-admin invariant, removal, and immediate authorization loss: Tasks 2–3 and 7.
- Seven-day same-email invitations, revoke/resend, duplicate acceptance, and email notification: Task 4.
- Uploader/admin file ownership, exact duplicate behavior, 100 MB/type boundary, private originals, web records, version creation, and soft delete: Task 5.
- Retry, partial success, failure preservation, atomic current-version switch, devices, and append-only audit: Task 6.
- Cross-team read/search/update/delete/upload/download isolation and ordinary-user proof: Task 7.
- Blank-project reproducibility and evidence-backed gate: Task 8.
- Parsing, OCR, webpage snapshot fetching, embeddings, hybrid ranking, client folder watching, upload UI, previews, and processing notifications remain explicitly outside Phase 1 and start only after a Phase 1 `GO`.
