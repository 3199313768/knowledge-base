# Phase 3 File List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the selected workspace file list and refresh it after upload completion.

**Architecture:** Keep Supabase reads in `fileService`, list state in `useFiles`, and rendering in `FileListPanel`. `MainShell` coordinates selected workspace, upload completion, and file refresh without moving Supabase calls into components.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Supabase JS v2.

## Global Constraints

- Do not commit or stage Git changes unless the user explicitly asks.
- Read-only file list only.
- No preview, download, soft delete, retry, realtime subscription, polling, or search in this step.
- Query only current workspace files and exclude `deleted_at`.
- Upload completion refreshes the list.

---

### Task 1: File service and formatting helpers

**Files:**
- Create: `apps/client/src/files/fileService.ts`
- Test: `apps/client/src/files/fileService.test.ts`

**Interfaces:**
- Produces: `FileService.listFiles(workspaceId: string): Promise<FileSummary[]>`
- Produces: `formatFileStatus(status: FileVersionStatus | null): string`
- Produces: `formatFileSize(sizeBytes: number | null): string`

- [ ] **Step 1: Write failing tests for status and size formatting**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/files/fileService.test.ts`

Expected: FAIL because `fileService.ts` does not exist.

- [ ] **Step 2: Implement minimal service and helpers**

Query `files` with current version relation, map null values safely, and throw safe errors.

- [ ] **Step 3: Run file service tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/files/fileService.test.ts`

Expected: PASS.

### Task 2: File list UI and upload refresh

**Files:**
- Create: `apps/client/src/files/useFiles.ts`
- Create: `apps/client/src/components/FileListPanel.tsx`
- Modify: `apps/client/src/components/UploadPanel.tsx`
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/App.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: `FileService.listFiles(workspaceId)`
- Consumes: `UploadPanel.onUploadSettled?: () => void`
- Produces: selected workspace file list with refresh button and empty/error states.

- [ ] **Step 1: Write failing App tests**

Cover list display, empty state, load error, and upload success refresh.

- [ ] **Step 2: Run failing App tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`

Expected: FAIL because file service injection and list UI do not exist.

- [ ] **Step 3: Implement UI and refresh wiring**

`MainShell` creates `useFiles(fileService, currentWorkspace?.id ?? null)` and passes refresh to `UploadPanel`.

- [ ] **Step 4: Run App tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`

Expected: PASS.

### Task 3: Final local gate

**Files:**
- Modify only files from Tasks 1 and 2 if verification surfaces issues.

- [ ] **Step 1: Run client unit tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit`

- [ ] **Step 2: Run client typecheck**

Run: `env CI=true pnpm --dir apps/client typecheck`

- [ ] **Step 3: Run client build**

Run: `env CI=true pnpm --dir apps/client build`

- [ ] **Step 4: Review diff**

Run: `git status --short` and inspect changed files before reporting.

