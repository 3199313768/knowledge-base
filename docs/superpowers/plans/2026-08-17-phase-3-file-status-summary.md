# Phase 3 File Status Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a current-workspace status summary and last-refresh timestamp to the file list.

**Architecture:** Keep status aggregation as pure helpers in `fileService`, preserve refresh state in `useFiles`, and render the summary inside `FileListPanel`.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

## Global Constraints

- Do not commit or stage Git changes unless the user explicitly asks.
- No realtime subscription.
- No polling.
- No new cloud RPC.
- No preview, download, delete, or retry.

---

### Task 1: Status summary helpers

**Files:**
- Modify: `apps/client/src/files/fileService.ts`
- Modify: `apps/client/src/files/fileService.test.ts`

**Interfaces:**
- Produces: `summarizeFileStatuses(files: FileSummary): FileStatusSummary`

- [ ] **Step 1: Write failing helper test**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/files/fileService.test.ts`

Expected: FAIL because `summarizeFileStatuses` does not exist.

- [ ] **Step 2: Implement helper**

Count total, active processing, searchable, and failed files.

### Task 2: UI summary and last refresh

**Files:**
- Modify: `apps/client/src/files/useFiles.ts`
- Modify: `apps/client/src/components/FileListPanel.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: `lastRefreshedAt: string | null`
- Produces: visible status summary and last refresh text.

- [ ] **Step 1: Write failing App test**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`

Expected: FAIL because summary and refresh timestamp are not rendered.

- [ ] **Step 2: Implement UI**

Render summary chips and timestamp in `FileListPanel`.

### Task 3: Final local gate

- [ ] Run: `env CI=true pnpm --filter knowledge-base test:unit`
- [ ] Run: `env CI=true pnpm --dir apps/client typecheck`
- [ ] Run: `env CI=true pnpm --dir apps/client build`
- [ ] Run: `git status --short`

