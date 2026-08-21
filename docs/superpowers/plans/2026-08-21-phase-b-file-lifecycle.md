# Phase B File Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成文件状态、可靠重试、回收站、恢复、永久删除与批量操作的端到端闭环。

**Architecture:** 以服务端状态机和受保护 RPC 作为唯一业务边界，客户端只消费稳定的 File ViewModel 和操作结果。文件列表、回收站、上传队列和批量操作分别由独立 hook/component 管理；所有异步列表操作都使用 workspace/request generation 防止旧响应污染当前团队。回收站默认保留 30 天，可信清理任务负责到期永久删除，用户可提前手动永久删除。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Supabase JS、Postgres migration/RLS、Storage。

**Spec:** 用户确认的第二优先级设计（本对话，2026-08-21）。

## Global Constraints

- 不引入新 npm/Rust 依赖。
- 前端只使用 Supabase URL 与 anon key；service role key 不得进入客户端。
- 用户可见文案统一中文；底层错误必须映射为稳定错误类型和可执行文案。
- 页面文件只负责组合；数据库访问集中在 service/RPC；不允许客户端直接修改 `deleted_at` 或文件状态。
- 所有删除、恢复、重试和批量操作都必须有权限边界、重复操作防护和独立测试。
- 永久删除必须同时处理数据库、Storage、处理任务和审计；任一清理失败不得伪装成功。
- 不执行 Git commit、push 或 PR，除非用户另行授权。
- Supabase migration、RLS、Storage 和普通 JWT 运行态证据必须与本地单测、类型检查、构建分开记录。

### Task 1: File status and retry state contract

**Files:**
- Modify: `apps/client/src/files/fileService.ts`
- Modify: `apps/client/src/files/useFiles.ts`
- Modify: `apps/client/src/uploads/useUploadQueue.ts`
- Modify: `apps/client/src/files/fileService.test.ts`
- Create: `apps/client/src/files/useFiles.test.ts`
- Create: `apps/client/src/uploads/useUploadQueue.test.ts`

**Interfaces:**
- Produce `FileOperationError` with stable `kind`, `message`, and `canRetry`.
- Preserve `FileService.retryFileVersion(versionId)` and add bounded retry metadata to `FileSummary`.
- `useFiles` must ignore stale refresh responses after workspace changes or overlapping refreshes.
- `useUploadQueue` must expose per-file state, duplicate outcome, retryability, and no-duplicate-submit behavior.

- [ ] **Step 1: Write failing tests** for status mapping, retry limit, duplicate clicks, stale workspace refresh, loading/error convergence, and safe error messages.
- [ ] **Step 2: Run focused file/upload tests and verify failure.**
- [ ] **Step 3: Implement stable service/hook contracts and request-generation guards.**
- [ ] **Step 4: Re-run focused tests, typecheck, and `git diff --check`.**

### Task 2: Status center and retry UI

**Files:**
- Create: `apps/client/src/components/FileStatusCenter.tsx`
- Create: `apps/client/src/components/FileStatusCenter.test.tsx`
- Modify: `apps/client/src/components/FileListPanel.tsx`
- Modify: `apps/client/src/components/FileInspector.tsx`
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`
- Modify: `apps/client/src/App.css`
- Modify: `apps/client/src/App.test.tsx`

**Interfaces:**
- `FileStatusCenter` accepts `summary`, `filter`, `onFilterChange`, and `onRetryFailed`.
- Status center displays total, uploading/processing, searchable, failed counts; covers loading, empty, error and success.
- Retry button is disabled while pending, announces progress, and shows per-item outcome.

- [ ] **Step 1: Add component and App tests** for filters, all status states, failed retry, disabled duplicate click, and accessible labels.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement status center and wire it to existing dashboard/file service boundaries.**
- [ ] **Step 4: Run client tests and typecheck.**

### Task 3: Recycle bin schema and authorized operations

**Files:**
- Create: `supabase/migrations/20260821000200_file_recycle_bin.sql`
- Create: `supabase/tests/file_recycle_bin_contract_test.sql`
- Modify: `apps/client/src/files/fileService.ts`
- Create: `apps/client/src/files/recycleBinService.ts`
- Create: `apps/client/src/files/recycleBinService.test.ts`

**Interfaces:**
- `listDeletedFiles(workspaceId): Promise<DeletedFileSummary[]>`.
- `restoreFile(fileId): Promise<void>`.
- `permanentlyDeleteFile(fileId): Promise<DeleteOperationResult>`.
- `purgeExpiredDeletedFiles(): Promise<PurgeSummary>` is worker-only and never callable from browser.

- [ ] **Step 1: Add service and static SQL tests** for member/non-member, deleted/non-deleted, restore ownership, permanent-delete authorization, audit creation, and 30-day retention metadata.
- [ ] **Step 2: Run focused service tests and verify failure.**
- [ ] **Step 3: Implement migration/RPCs with explicit grants, RLS, transactional state changes, Storage cleanup result tracking, and worker-only purge boundary.**
- [ ] **Step 4: Implement browser service with safe errors and verify focused tests.**

### Task 4: Recycle bin UI and restore/delete flows

**Files:**
- Create: `apps/client/src/components/RecycleBinPage.tsx`
- Create: `apps/client/src/components/RecycleBinPage.test.tsx`
- Create: `apps/client/src/components/DeleteConfirmationDialog.tsx`
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/components/AppSidebar.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Recycle bin route/view receives `recycleBinService`, current workspace, and refresh callbacks through existing page composition.
- Restore returns the file to the active list; permanent delete requires explicit confirmation and reports partial cleanup failure without false success.
- UI includes empty, loading, error, restore-in-progress, delete-in-progress and success states.

- [ ] **Step 1: Add UI tests** for navigation, empty state, restore, permanent-delete confirmation/cancel, repeated action prevention, and partial failure messaging.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement the page/dialog with semantic controls and existing shared UI components.**
- [ ] **Step 4: Run full client tests, typecheck, and build.**

### Task 5: Batch upload/retry/delete operations

**Files:**
- Create: `apps/client/src/uploads/useBatchUpload.ts`
- Create: `apps/client/src/files/useBatchFileOperations.ts`
- Create: `apps/client/src/uploads/useBatchUpload.test.ts`
- Create: `apps/client/src/files/useBatchFileOperations.test.ts`
- Create: `apps/client/src/components/BatchOperationSummary.tsx`
- Create: `apps/client/src/components/BatchOperationSummary.test.tsx`
- Modify: `apps/client/src/components/UploadPanel.tsx`
- Modify: `apps/client/src/components/FileListPanel.tsx`
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`

**Interfaces:**
- Batch operations return `{ succeeded, failed, skipped, results }` per item.
- A batch is cancellable only before a request is sent; already-sent operations finish with exact per-item status.
- Duplicate files are `skipped`, not failures; retry-limit and permission failures are `failed` with safe reasons.

- [ ] **Step 1: Add tests** for mixed success/duplicate/failure, concurrency limit, cancellation boundary, retry idempotency, and summary rendering.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement batch hooks with bounded concurrency and no global state.**
- [ ] **Step 4: Integrate UI and run full client tests/typecheck/build.**

### Task 6: End-to-end verification and handoff

**Files:**
- Create: `supabase/tests/file_lifecycle_cloud.test.ts` or the project-approved cloud test location
- Create: `docs/完成报告/客户端/文件生命周期/20260821/报告-文件生命周期.md`
- Modify: `docs/superpowers/plans/2026-08-21-phase-b-file-lifecycle.md`

- [ ] **Step 1: Run local unit tests and typecheck separately from cloud tests.**
- [ ] **Step 2: Run production build and `git diff --check`.**
- [ ] **Step 3: Browser-verify status center, retry, recycle bin, restore, permanent-delete confirmation, and batch mixed outcomes.**
- [ ] **Step 4: With explicit authorization and dedicated allowlisted non-production target, run ordinary-JWT RLS/Storage/cleanup tests; keep UNRUN when not authorized.**
- [ ] **Step 5: Record exact evidence, limitations, and changed files in the eight-section completion report.**
