# Phase 1 Decision

- Decision date: 2026-08-10
- Evidence status: **NOT EVALUATED**
- Release posture: **NO-GO FOR RELEASE**
- Interpretation: mandatory runtime evidence is unavailable because execution was explicitly cancelled; this is an evidence insufficiency decision, not a finding that the static source failed.

## Target isolation

- Date: 2026-08-10
- Target type: NOT RESOLVED — requires an explicitly approved disposable, non-production Supabase Branch or blank development project containing only synthetic data and different from the long-lived development project.
- Status: **UNRUN**
- Planned command:

  ```bash
  test -n "$PHASE1_REBUILD_PROJECT_REF"
  supabase projects list
  ```

- Exit code: NOT RECORDED — commands were not run.
- Test count: NOT RECORDED — no target check ran.
- Observed result: **NOT EVALUATED** — no disposable target was approved, no project link was inspected or changed, and no project ref or secret value was read or recorded.
- Blocking conditions: the source-controlled cloud-test allowlist is empty; no disposable project/branch, project link, migration deployment, Storage access, cloud mutation, or cleanup was approved.

## Migration rebuild

- Date: 2026-08-10
- Target type: unresolved disposable non-production Supabase target.
- Status: **UNRUN**
- Planned command:

  ```bash
  supabase link --project-ref "$PHASE1_REBUILD_PROJECT_REF"
  supabase migration list
  supabase db push --include-all
  supabase migration list
  ```

- Exit code: NOT RECORDED — commands were not run.
- Test count: NOT RECORDED — no migration was replayed.
- Observed result: **NOT EVALUATED** — blank-project reproducibility and local/remote migration-history equality have no runtime evidence.
- Static migration inventory, in filename order:

  1. `20260804000100_search_spike.sql`
  2. `20260807000100_phase1_schema.sql`
  3. `20260807000200_phase1_workspace_security.sql`
  4. `20260807000300_phase1_invitations.sql`
  5. `20260807000400_phase1_files_storage.sql`
  6. `20260807000500_phase1_processing_audit.sql`

This inventory confirms only that the files are present and ordered. It is not migration execution evidence.

## Authentication and workspace authorization

- Date: 2026-08-10
- Target type: unresolved dedicated, allowlisted, synthetic-only development target; authorization assertions must use ordinary `authenticated` JWT clients.
- Status: **UNRUN**
- Planned focused command:

  ```bash
  pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.cloud.config.ts src/workspace-access.cloud.test.ts
  ```

- Required combined cloud gate: `pnpm test:cloud`
- Exit code: NOT RECORDED — commands were not run.
- Test count: NOT RECORDED — no authorized cloud suite ran.
- Observed result: **NOT EVALUATED** — cross-workspace read/search/update/delete denial, last-admin protection, multi-workspace access, removal, and immediate authorization loss have no runtime evidence.
- Evidence boundary: Phase 0 service-role RPC filtering and historical Recall@5 evidence cannot establish Phase 1 RLS or ordinary-user authorization.

## Invitation lifecycle and email delivery

- Date: 2026-08-10
- Target type: unresolved dedicated, allowlisted, synthetic-only development target; live email additionally requires an approved Deno/Edge deployment and Resend test configuration.
- Invitation lifecycle status: **UNRUN**
- Planned lifecycle command:

  ```bash
  pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.cloud.config.ts src/invitations.cloud.test.ts
  ```

- Mocked email status: **UNRUN**
- Planned mocked-email command:

  ```bash
  deno test supabase/functions/send-workspace-invitation/index.test.ts
  ```

- Live email status: **UNRUN**
- Live email command: NOT DEFINED — no deployment/live-email runbook has been approved, so no command is fabricated here.
- Exit code: NOT RECORDED — no lifecycle, Deno, Edge, Resend, or live-email command ran.
- Test count: NOT RECORDED — no invitation or email test ran.
- Observed result: **NOT EVALUATED** — seven-day expiry, same-email acceptance, revoke/resend, duplicate/concurrent acceptance, mocked delivery, deployed handler behavior, and real inbox delivery remain unobserved. Mocked email and live email must remain separate evidence layers.

## Private Storage

- Date: 2026-08-10
- Target type: unresolved dedicated, allowlisted, synthetic-only development target; after migration replay, the future target must contain a private `documents` bucket. Current bucket privacy is **NOT EVALUATED**.
- Status: **UNRUN**
- Planned focused command:

  ```bash
  pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.cloud.config.ts src/files-storage.cloud.test.ts
  ```

- Exit code: NOT RECORDED — the command was not run.
- Test count: NOT RECORDED — no Storage test ran.
- Observed result: **NOT EVALUATED** — bucket privacy, signed upload with `upsert: false`, 60-second signed download, cross-workspace denial, malformed-path rejection, member removal, cleanup, and zero object leftovers have no runtime evidence.
- Static configuration/source inspection does not prove deployed bucket policy or signed URL behavior.

## File state machine and audit

- Date: 2026-08-10
- Target type: unresolved dedicated, allowlisted, synthetic-only development target.
- Status: **UNRUN**
- Planned focused command:

  ```bash
  pnpm --filter @knowledge-base/cloud-foundation exec vitest run --config vitest.cloud.config.ts src/processing-state.cloud.test.ts
  ```

- Exit code: NOT RECORDED — the command was not run.
- Test count: NOT RECORDED — no state-machine test ran.
- Observed result: **NOT EVALUATED** — legal/illegal transitions, retry bounds, concurrent claim behavior, searchable/partial/failure finalization, old-current-version preservation on failed replacement, atomic successful switch, current-only chunks, device scope, and append-only audit have no runtime evidence.

## Verification summary

| Layer | Exact future command | Status | Exit code | Count | Observed result |
| --- | --- | --- | --- | --- | --- |
| Hermetic unit tests | `pnpm test` | **UNRUN** | NOT RECORDED | NOT RECORDED | **NOT EVALUATED** |
| TypeScript | `pnpm typecheck` | **UNRUN** | NOT RECORDED | NOT RECORDED | **NOT EVALUATED** |
| Local/branch pgTAP | `supabase test db supabase/tests/phase1_schema_test.sql` | **UNRUN** | NOT RECORDED | NOT RECORDED | **NOT EVALUATED**; Docker/pgTAP execution was not authorized |
| Ordinary-JWT cloud suites | `pnpm test:cloud` | **UNRUN** | NOT RECORDED | NOT RECORDED | **NOT EVALUATED** |
| Required combined gate | `pnpm verify:phase-1` | **UNRUN** | NOT RECORDED | NOT RECORDED | **NOT EVALUATED** |
| Mocked invitation email | `deno test supabase/functions/send-workspace-invitation/index.test.ts` | **UNRUN** | NOT RECORDED | NOT RECORDED | **NOT EVALUATED** |
| Live invitation email | command not yet approved/defined | **UNRUN** | NOT RECORDED | NOT RECORDED | **NOT EVALUATED** |
| Synthetic-resource cleanup | exact tracked-ID/path verification performed by the authorized cloud gate | **UNRUN** | NOT RECORDED | NOT RECORDED | **NOT EVALUATED** |

Required environment names, without values:

- Rebuild shell only: `PHASE1_REBUILD_PROJECT_REF`
- Cloud gate: `SUPABASE_ENVIRONMENT`, `SUPABASE_TEST_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Invitation deployment/live email: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INVITATION_ACCEPT_BASE_URL`, `RESEND_API_KEY`, `INVITATION_FROM_EMAIL`

The rebuild variable and all secret values must remain shell-local or in ignored environment configuration; they must not be written into this document.

Task 7 incident boundary: a local `pnpm test:cloud` command substitution was accidentally started during a prior static check. It was not an authorized gate run, yielded no accepted exit code/test count/result, and no cloud client, network request, or cloud resource activity was observed in its output. It is not evidence for this decision.

## Remaining limitations

- User direction for this implementation round explicitly cancelled tests and cloud execution.
- No disposable Supabase Branch/blank project is approved; no project linking, migration deployment, Storage operation, cloud write, cleanup, or network access is authorized.
- `apps/cloud-foundation/src/approvedTestProjects.ts` contains an empty allowlist, so cloud writes intentionally fail closed before client creation.
- Workspace dependency links were not restored after the earlier unsuccessful offline install; package and type gates cannot be evaluated until that separate recovery is authorized and completed.
- Deno execution, Edge Function deployment, Resend configuration, and live email delivery were not approved.
- No zero-leftover observation exists for synthetic database rows, Auth users, invitations, Storage objects, or secrets.
- Phase 0 evidence is historical feasibility evidence only and does not satisfy any Phase 1 authorization gate.

Future blank-project rebuild checklist — review and approve before execution:

- [ ] Approve a disposable Supabase Branch or blank development project that is not production, differs from the long-lived development project, and contains no real/non-synthetic data.
- [ ] Add only that dedicated cloud-test ref to the source-controlled allowlist through review; keep ref and secret values out of reports.
- [ ] Record the original development link in the current shell so it can be restored; do not mutate the long-lived project during rebuild proof.
- [ ] Inspect target identity and migration history before mutation.
- [ ] Replay the six ordered migrations without manual Dashboard SQL and confirm local/remote migration histories match.
- [ ] Confirm the `documents` bucket is private and run signed upload/download authorization checks with ordinary JWTs.
- [ ] Run local hermetic tests and typecheck separately from the ordinary-JWT real-cloud suites; record commands, dates, exit codes, and counts per layer.
- [ ] Record local/branch pgTAP as its own layer; if Docker is unavailable, retain `UNRUN` rather than substituting cloud or static evidence.
- [ ] Run the ordinary-JWT workspace, invitation, Storage, state-machine, audit, and cleanup matrix; service role may prepare/clean fixtures but must not prove authorization.
- [ ] Verify cleanup by exact tracked IDs and Storage path prefixes and observe zero synthetic leftovers before disposing of the target.
- [ ] Run mocked invitation email and deployed live-email delivery as separate layers; approve Deno, deployment, Resend, sender, acceptance URL, and inbox beforehand.
- [ ] Only after the authorized gates finish and exact cleanup observes zero synthetic leftovers, restore the original development link and verify it with `supabase migration list`; do not leave the repository linked to the disposable rebuild target.
- [ ] After the original link is verified, restore or clear every temporary target-specific environment variable and clear the shell-local `PHASE1_REBUILD_PROJECT_REF`.
- [ ] Remove the disposable project ref from `apps/cloud-foundation/src/approvedTestProjects.ts` through review. The approved ref may exist temporarily in the controlled allowlist during the authorized run, but it must not remain after that disposable run ends.
- [ ] Only after the disposable ref is removed from the allowlist, perform the authorized reviewer check that Git-tracked files contain no copy of that temporary ref, credential, `.env` value, environment value, or secret; record only non-secret target types and evidence.

## Decision

**Decision:** NOT EVALUATED

**Release posture:** NO-GO FOR RELEASE

Phase 1 is not complete. Mandatory blank-project rebuild, ordinary-user RLS/Storage, invitation lifecycle, processing-state, cleanup, local gate, cloud gate, and live-email evidence is unavailable. This posture is caused by missing execution evidence and approvals, not by an observed static source failure. The roadmap must remain in Phase 1, and Phase 2 planning or implementation must not begin from this record.
