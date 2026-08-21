# Phase A Search and Reading Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成搜索结果、文件详情/预览入口与当前团队搜索历史的端到端闭环。

**Architecture:** 保持页面组合、业务组件、service/hook 分层。搜索 service 负责 RPC 与稳定错误分类，搜索组件负责结果/空态/错误态；文件 service 负责受权限保护的 signed URL；search history service 负责 Supabase 表读写和用户/团队边界。数据库迁移与 RLS 先于前端接入完成。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Supabase JS、Postgres migration/RLS。

**Spec:** 用户确认的阶段 A 设计（本对话，2026-08-21）。

## Global Constraints

- 不引入新 npm/Rust 依赖。
- 前端只使用 Supabase URL 与 anon key；service role key 不得进入客户端。
- 用户可见文案统一中文；底层错误由 service 映射为稳定文案。
- 页面组件只组合组件，不直接创建 Supabase client。
- 先测试后实现；每个任务独立运行相关测试。
- 不执行 Git commit、push 或 PR，除非用户另行授权。

### Task 1: Search error contract and result model

**Files:**
- Modify: `apps/client/src/search/searchService.ts`
- Modify: `apps/client/src/search/searchService.test.ts`
- Modify: `apps/client/src/search/useSearch.ts`

**Interfaces:**
- Produce `SearchErrorKind = 'configuration' | 'permission' | 'network' | 'unknown'` and `SearchServiceError` with `kind` and user-safe `message`.
- Preserve `SearchResultSummary` and `SearchService.search(input)` signatures.

- [ ] Step 1: Add tests for successful mapping, empty results, permission/configuration/network error mapping, and trimmed empty query.
- [ ] Step 2: Run `pnpm --filter knowledge-base test:unit -- src/search/searchService.test.ts`; verify new error tests fail.
- [ ] Step 3: Implement a classifier that never exposes raw Supabase details to UI and update `useSearch` to expose retryable error state.
- [ ] Step 4: Re-run the focused search service tests and the existing hook/component tests.

### Task 2: Search result presentation

**Files:**
- Create: `apps/client/src/components/SearchResults.tsx`
- Create: `apps/client/src/components/SearchResultItem.tsx`
- Modify: `apps/client/src/components/SearchPanel.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- `SearchResultsProps` accepts `results`, `isLoading`, `error`, `query`, `onRetry`, and `onOpenFile(fileId)`.
- Results show file name, score, snippet, source label, loading, empty, and retryable error states.

- [ ] Step 1: Add component tests for loading, empty, error/retry, and result activation using accessible roles.
- [ ] Step 2: Run focused tests and verify failure before implementation.
- [ ] Step 3: Implement the two small presentation components and wire them through `SearchPanel`.
- [ ] Step 4: Run focused tests and confirm no raw service error is rendered.

### Task 3: Protected file preview service

**Files:**
- Modify: `apps/client/src/files/fileService.ts`
- Modify: `apps/client/src/files/fileService.test.ts`
- Modify: `apps/client/src/components/FileInspector.tsx`
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`

**Interfaces:**
- Extend `FileService` with `getFilePreviewUrl(fileId: string): Promise<string>`.
- `FileInspector` receives `onPreviewFile(file)` and displays PDF preview/open action, DOCX open/download guidance, and unsupported-type guidance.

- [ ] Step 1: Add service tests for signed URL success, missing URL, and RPC/storage permission failure.
- [ ] Step 2: Run focused file tests and verify failure.
- [ ] Step 3: Implement service-side path resolution/RPC boundary and inspector preview action with loading/error state.
- [ ] Step 4: Add dashboard tests for selected-file preview action and run focused tests.

### Task 4: Search history database contract

**Files:**
- Create: `supabase/migrations/20260821000100_search_history.sql`
- Create: `supabase/tests/search_history_test.sql`
- Modify: `apps/client/src/search/searchHistoryService.ts`
- Create: `apps/client/src/search/searchHistoryService.test.ts`

**Interfaces:**
- `SearchHistoryService.list(workspaceId, limit): Promise<SearchHistoryItem[]>`.
- `SearchHistoryService.record({workspaceId, query}): Promise<void>`.
- `SearchHistoryService.clear(workspaceId): Promise<void>`.

- [ ] Step 1: Add migration tests/SQL assertions for table, indexes, RLS, own-user policy, and workspace membership boundary.
- [ ] Step 2: Add service unit tests using a mocked Supabase client for list/record/clear and stable errors.
- [ ] Step 3: Implement migration with `user_id`, `workspace_id`, normalized query, timestamps, and policies that prevent cross-user/workspace access.
- [ ] Step 4: Implement browser service using anon Supabase client only and verify service tests.

### Task 5: Search history UI integration

**Files:**
- Create: `apps/client/src/components/SearchHistory.tsx`
- Modify: `apps/client/src/components/SearchPanel.tsx`
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- `SearchHistory` accepts `items`, `isLoading`, `onSelect(query)`, and `onClear`.
- Search submit records only non-empty queries after a successful request; clicking history repopulates and executes the query.

- [ ] Step 1: Add UI tests for history display, re-run, clear, and empty state.
- [ ] Step 2: Run focused tests and verify failure.
- [ ] Step 3: Wire history hook/service into the current workspace dashboard without adding global state.
- [ ] Step 4: Run all client unit tests, typecheck, and build.

### Task 6: Browser acceptance and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-08-21-phase-a-search-reading-loop.md`
- Create: `docs/完成报告/客户端/搜索与阅读闭环/20260821/报告-搜索与阅读闭环.md`

- [ ] Step 1: Run `pnpm --filter knowledge-base test:unit`.
- [ ] Step 2: Run `pnpm --dir apps/client typecheck`.
- [ ] Step 3: Run `pnpm --dir apps/client build`.
- [ ] Step 4: Run browser acceptance for success, empty, error/retry, PDF preview action, DOCX guidance, history re-run, and clear history.
- [ ] Step 5: Record observed evidence, limitations, and exact changed-file list in the eight-section completion report; do not claim cloud RLS runtime pass unless the authorized cloud gate actually ran.
