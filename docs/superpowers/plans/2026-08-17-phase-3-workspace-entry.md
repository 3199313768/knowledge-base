# Phase 3 Workspace Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a logged-in team/workspace entry point before upload/search features.

**Architecture:** Keep Supabase workspace access in a small service, React state in a hook, and UI in a dedicated panel. `App` remains the auth-level router and injects services for tests.

**Tech Stack:** React 19, TypeScript, Supabase JS 2, Vitest, Testing Library.

## Global Constraints

- 文档和用户可见文案使用中文。
- 不新增 SQL，不修改 Phase 1/2 云端门禁。
- 前端只使用 anon/publishable key，禁止 service role 进入 client。
- 不 commit，不 stage。

---

### Task 1: Workspace service and tests

**Files:**
- Create: `apps/client/src/workspaces/workspaceService.ts`
- Modify: `apps/client/src/lib/supabaseClient.ts`

**Interfaces:**
- Produces:
  - `WorkspaceSummary = { id: string; name: string; createdAt: string | null }`
  - `WorkspaceService = { listWorkspaces(): Promise<WorkspaceSummary[]>; createWorkspace(name: string): Promise<string> }`

- [ ] Add failing app-level tests that require workspace listing and creation.
- [ ] Implement the service with `from('workspaces').select('id,name,created_at').order('created_at', { ascending: false })`.
- [ ] Implement `createWorkspace(name)` with `rpc('create_workspace', { p_name: name })`.
- [ ] Run `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`.

### Task 2: Workspace hook and panel

**Files:**
- Create: `apps/client/src/workspaces/useWorkspaces.ts`
- Create: `apps/client/src/components/WorkspacePanel.tsx`
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/App.tsx`

**Interfaces:**
- Consumes `WorkspaceService`.
- Produces logged-in workspace UI with loading, empty, create, select, and error states.

- [ ] Add tests for empty state, create success, select existing workspace, and read failure.
- [ ] Implement `useWorkspaces(workspaceService)`.
- [ ] Implement `WorkspacePanel`.
- [ ] Wire `MainShell` and `App`.
- [ ] Run client unit tests, typecheck, build.

### Task 3: Final verification

**Files:**
- No new source files.

- [ ] Run `env CI=true pnpm --filter knowledge-base test:unit`.
- [ ] Run `env CI=true pnpm --dir apps/client typecheck`.
- [ ] Run `env CI=true pnpm --dir apps/client build`.
- [ ] Run `env CI=true pnpm test`.
- [ ] Run `env CI=true pnpm typecheck`.
