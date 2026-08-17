# Phase 3 macOS Workbench Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the logged-in client shell into a macOS Finder / Settings style workbench without changing backend behavior.

**Architecture:** Add small shared UI components under `components/ui`, move sidebar concerns into `AppSidebar`, and move the right-side document workspace into `WorkspaceDashboard`. Keep `MainShell` as the coordinator for auth email, workspace state, files state, upload refresh, and service injection.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing CSS, no new dependencies.

## Global Constraints

- Do not commit or stage Git changes unless the user explicitly asks.
- User-visible copy must be Chinese.
- Do not change Supabase auth, workspace, upload, or file service behavior.
- Do not add search, preview, download, delete, retry, realtime, or polling.
- Shared visual primitives belong in `apps/client/src/components/ui`.

---

### Task 1: Lock the new workbench semantics with tests

**Files:**
- Modify: `apps/client/src/App.test.tsx`

**Interfaces:**
- Consumes existing `App` service injection props.
- Produces app-level assertions for `应用导航`, `资料`, `搜索`, `上传`, `设置`, `知识库工作台`, and account sign-out from the sidebar footer.

- [ ] **Step 1: Write failing tests**

Add tests requiring the logged-in shell to expose a sidebar navigation region and a default document workbench title.

- [ ] **Step 2: Run failing tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`

Expected: FAIL because the current shell has no navigation region and no `知识库工作台` title.

### Task 2: Add shared UI primitives and layout components

**Files:**
- Create: `apps/client/src/components/ui/Button.tsx`
- Create: `apps/client/src/components/ui/Card.tsx`
- Create: `apps/client/src/components/ui/Badge.tsx`
- Create: `apps/client/src/components/ui/TextInput.tsx`
- Create: `apps/client/src/components/AppSidebar.tsx`
- Create: `apps/client/src/components/WorkspaceDashboard.tsx`
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/components/WorkspacePanel.tsx`
- Modify: `apps/client/src/components/UploadPanel.tsx`
- Modify: `apps/client/src/components/FileListPanel.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Produces `AppSidebar` props for email, workspace state, and sign-out callback.
- Produces `WorkspaceDashboard` props for current workspace, upload service, file list state, and refresh callback.

- [ ] **Step 1: Implement primitives**

Wrap existing class naming with small reusable components; do not introduce new dependencies.

- [ ] **Step 2: Split layout**

Move sidebar JSX out of `MainShell`, move right pane dashboard JSX into `WorkspaceDashboard`, and keep `MainShell` as coordinator.

- [ ] **Step 3: Update CSS**

Use macOS-style muted surfaces, sidebar navigation rows, top status cards, compact upload card, and responsive single-column fallback.

### Task 3: Verification

**Files:**
- Modify only files in Tasks 1 and 2 if verification surfaces issues.

- [ ] **Step 1: Run client tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit`

- [ ] **Step 2: Run client typecheck**

Run: `env CI=true pnpm --dir apps/client typecheck`

- [ ] **Step 3: Run client build**

Run: `env CI=true pnpm --dir apps/client build`

- [ ] **Step 4: Review status**

Run: `git status --short` and inspect changed files.

