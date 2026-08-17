# Phase 3 Knowledge Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Phase 3 core knowledge-base workbench: team selection, upload, file status, search, soft delete, and failed-version retry.

**Architecture:** Keep every cloud boundary in focused services, every async view state in hooks, and every visual section in dedicated React components. `MainShell` coordinates the selected workspace and refresh events but does not call Supabase directly.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Supabase JS v2, Web Crypto.

## Global Constraints

- Do not commit or stage Git changes unless the user explicitly asks.
- No realtime subscription.
- No automatic polling.
- No file preview.
- No original file download.
- No batch upload.
- No folder watching.
- No iOS share extension consumption.
- No member invitation or permission management.
- No AI answer generation.

---

### Task 1: Preserve existing workbench foundation

**Files:**
- Existing: `apps/client/src/auth/*`
- Existing: `apps/client/src/workspaces/*`
- Existing: `apps/client/src/uploads/*`
- Existing: `apps/client/src/files/*`
- Existing: `apps/client/src/components/UploadPanel.tsx`
- Existing: `apps/client/src/components/FileListPanel.tsx`

**Interfaces:**
- Consumes: `WorkspaceService`, `UploadService`, `FileService`
- Produces: selected workspace shell with upload, file list, status summary, and refresh hooks.

- [ ] Verify existing tests still cover login, workspace selection, upload, file listing, upload refresh, and status summary.

### Task 2: Search service and search panel

**Files:**
- Create: `apps/client/src/search/searchService.ts`
- Create: `apps/client/src/search/searchService.test.ts`
- Create: `apps/client/src/search/useSearch.ts`
- Create: `apps/client/src/components/SearchPanel.tsx`
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/App.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Produces: `SearchService.search(input: SearchFilesInput): Promise<SearchResultSummary[]>`
- Produces: `tokenizeSearchQuery(text: string): string[]`
- Produces: `neutralQueryVectorLiteral(): string`
- Consumes RPC: `search_workspace_files(p_workspace_id,p_query_embedding,p_query_tokens,p_query_text,p_filters,p_limit)`

- [ ] Write failing tests for query tokenization, blank query rejection, search result mapping, and App-level search UI.
- [ ] Implement service, hook, and panel.
- [ ] Run focused tests.

### Task 3: File soft delete and failed retry

**Files:**
- Modify: `apps/client/src/files/fileService.ts`
- Modify: `apps/client/src/components/FileListPanel.tsx`
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Extends: `FileService.softDeleteFile(fileId: string): Promise<void>`
- Extends: `FileService.retryFileVersion(versionId: string): Promise<void>`

- [ ] Write failing App tests for delete confirmation, refresh after delete, retry failed file, and hiding retry for non-failed files.
- [ ] Implement file actions in service and panel.
- [ ] Run focused tests.

### Task 4: Final local gate

- [ ] Run `env CI=true pnpm --filter knowledge-base test:unit`.
- [ ] Run `env CI=true pnpm --dir apps/client typecheck`.
- [ ] Run `env CI=true pnpm --dir apps/client build`.
- [ ] Run `git status --short`.
- [ ] Check running Tauri dev HMR output.

