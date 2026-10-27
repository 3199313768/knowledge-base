# Knowledge Base Oxygen UI Client Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the knowledge-base client's duplicated generic UI with the published `@oxygen-design/ui@0.1.0` package while preserving authentication, Supabase services, Tauri commands, file lifecycle behavior, search, upload, workspace, and recycle-bin behavior.

**Architecture:** Keep `apps/client` as the only migration boundary. Import Oxygen's compiled stylesheet once at the React entry point. Convert the existing `components/ui` modules into compatibility adapters backed by Oxygen exports, then migrate the auth and application shell to Oxygen field, alert, dialog, page-state, icon, and `AppShell` primitives. Business components keep their existing hooks, service calls, view models, and Chinese state copy; only generic markup and styling ownership changes.

**Tech Stack:** pnpm workspace, React 19, TypeScript, Vite, Vitest + Testing Library, React Hook Form, Radix-backed `@oxygen-design/ui@0.1.0`, Supabase, Tauri.

## Global Constraints

- Preserve all unrelated dirty worktree changes. Do not reset, checkout, or rewrite user-owned files.
- Do not change Supabase clients, service interfaces, auth contracts, Tauri commands, or native iOS code.
- Do not commit, push, or publish changes from the knowledge-base repository without explicit authorization.
- Use Oxygen components as the implementation source for generic UI. Compatibility adapters may preserve existing imports but must not duplicate styles or behavior.
- Keep Chinese user-visible copy and existing loading, empty, error, permission, disabled, retry, and confirmation behavior.
- Before each implementation task, write or update the focused test that describes the changed contract; run it red before the minimal implementation.
- Use accessible roles, labels, visible text, and keyboard interactions in tests instead of CSS selectors or DOM structure.

## Task 1: Add the Oxygen dependency and stylesheet entry

**Files:**
- Modify: `apps/client/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/client/src/main.tsx`
- Add: `apps/client/src/oxygen-ui-adoption.test.tsx`

- [x] Add `@oxygen-design/ui@0.1.0` to the client runtime dependencies using the workspace's pnpm workflow and update the lockfile only as required.
- [x] Add a small entry-point contract test that reads the client source module and asserts the package stylesheet is imported exactly once through the React entry point.
- [x] Run the new test before adding the import and record the expected failing result.
- [x] Import `@oxygen-design/ui/styles.css` once from `apps/client/src/main.tsx`, preserving the existing React bootstrap order.
- [x] Run the focused test and verify the dependency resolves from the lockfile.

## Task 2: Convert local UI modules into Oxygen-backed adapters

**Files:**
- Add: `apps/client/src/components/ui/ui-adapters.test.tsx`
- Modify: `apps/client/src/components/ui/Button.tsx`
- Modify: `apps/client/src/components/ui/Card.tsx`
- Modify: `apps/client/src/components/ui/Badge.tsx`
- Modify: `apps/client/src/components/ui/TextInput.tsx`
- No additional barrel file; current consumers import the local modules directly.

- [x] Inspect the installed package declarations/source for exact `Button`, `Card`, `Badge`, and `Input` prop names and variants before editing adapters.
- [x] Add failing tests covering accessible button name, disabled state, local variant compatibility, card content, badge status text, input ref/value behavior, and preservation of caller `className`.
- [x] Run the adapter tests red against the current local implementations where the package-backed contract is absent.
- [x] Replace local implementations with thin wrappers or re-exports that map the existing local prop surface to Oxygen components; keep only compatibility mappings such as `primary` and `nav`.
- [x] Make Oxygen own the rendered primitive while retaining only temporary compatibility class names; page-specific class names continue to pass through unchanged.
- [x] Run the adapter tests and relevant existing component tests.

## Task 3: Migrate authentication and reusable form feedback

**Files:**
- Modify: `apps/client/src/components/AuthCard.tsx`
- Modify: `apps/client/src/components/ui/PasswordInput.tsx`
- Modify: `apps/client/src/components/DeleteConfirmationDialog.tsx`
- Modify: `apps/client/src/App.tsx`
- Add or modify focused tests next to the affected components.

- [x] Add failing coverage for login field labels/errors, submit disabled state, password visibility toggle, auth loading state, and delete dialog keyboard/confirm/cancel behavior.
- [x] Replace manual field/error markup with Oxygen `Label`, `Field`, `FieldError`, and `Alert` primitives without changing React Hook Form validation or service calls.
- [x] Implement `PasswordInput` as a business composition over Oxygen `Input`, `Button`, `Eye`, and `EyeOff` while preserving its accessible label and toggle behavior.
- [x] Replace the hand-written delete overlay with Oxygen `AlertDialog` primitives while preserving the existing title, description, cancel, confirm, pending, and callback behavior.
- [x] Use Oxygen status/alert primitives for the app-level auth loading and safe error presentation; do not expose raw errors.
- [x] Run focused auth/dialog tests and the existing `App.test.tsx` suite.

## Task 4: Migrate the application shell and navigation

**Files:**
- Add: `apps/client/src/components/AppSidebar.test.tsx` or the nearest existing shell test location
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/components/AppSidebar.tsx`
- Modify: `apps/client/src/App.css`

- [x] Add failing shell tests for active navigation, accessible navigation names, sign-out callback, workspace display, and mobile navigation content.
- [x] Replace hand-drawn navigation SVGs and text glyphs with Oxygen icon exports while preserving the `SidebarSection` mapping and callbacks.
- [x] Extract shared navigation content so desktop sidebar and mobile navigation cannot drift.
- [x] Compose the existing sidebar and page content through Oxygen `AppShell`; preserve existing page selection, action-error display, and workspace/file hook ownership.
- [x] Keep page-specific layout selectors while deferring removal of duplicated generic rules to the dedicated CSS task.
- [x] Run shell tests plus existing workspace/dashboard tests and inspect the rendered DOM for desktop and mobile navigation.

## Task 5: Migrate page primitives and business surface states

**Files:**
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`
- Modify: `apps/client/src/components/WorkspacePanel.tsx`
- Modify: `apps/client/src/components/FileListPanel.tsx`
- Modify: `apps/client/src/components/FileInspector.tsx`
- Modify: `apps/client/src/components/FileStatusCenter.tsx`
- Modify: `apps/client/src/components/UploadPanel.tsx`
- Modify: `apps/client/src/components/SearchPanel.tsx`
- Modify: `apps/client/src/components/SearchResults.tsx`
- Modify: `apps/client/src/components/SearchHistory.tsx`
- Modify: `apps/client/src/components/TeamsPage.tsx`
- Modify: `apps/client/src/components/RecycleBinPage.tsx`
- Modify: `apps/client/src/components/PlaceholderPage.tsx`
- Modify: `apps/client/src/components/BatchOperationSummary.tsx`
- Modify: `apps/client/src/components/SearchResultItem.tsx`
- Modify: affected `*.test.tsx` files alongside each component

- [x] For each markup change, add or extend focused tests for loading, empty, error, success, retry, disabled, permission, and destructive-action states that already exist in the component.
- [x] Replace repeated headings with Oxygen `PageHeader`, repeated empty/loading/error blocks with `EmptyState` and `StatusMessage`, and service/error banners with `Alert` without changing state transitions or view-model conversion.
- [x] Replace generic buttons/cards/badges/inputs with the adapters or direct Oxygen imports where the file is already being changed.
- [x] Preserve upload retry and duplicate-submit guards, search history behavior, file inspector selection, batch-operation summaries, and recycle-bin callbacks.
- [x] Run the focused page suites after each coherent group: workspace/file, search/history, and teams/recycle/upload.

## Task 6: Remove conflicting generic CSS and verify package ownership

**Files:**
- Modify: `apps/client/src/App.css`
- Modify only additional client style files found during focused inspection.

- [x] Inventory remaining selectors for `.button`, `.ui-card`, `.badge`, `.text-input`, generic field/error/dialog rules, and duplicate shell primitives.
- [x] Remove only rules now owned by Oxygen; preserve layout, responsive breakpoints, page-specific states, and domain visuals.
- [ ] Run `git diff --check` and inspect computed styles for representative auth, shell, file, search, empty, error, and dialog states.

  `git diff --check` passed. The authenticated shell/file/search/dialog computed-style subset remains pending because this local run has no authenticated Supabase session; auth desktop/mobile computed styles and screenshots were verified.
- [x] Confirm no package CSS is imported from more than one application entry or component module.

## Task 7: Run the verification chain and browser checks

**Files:**
- No production code changes unless verification exposes a concrete issue.
- Add or update focused tests only when a verified issue requires it.

- [x] Run the client unit suite (equivalent direct Vitest command: 19 files, 155 tests passed).
- [x] Run the client typecheck (equivalent direct `tsc --noEmit` command passed).
- [x] Run the client production build (equivalent direct `vite build` command passed; existing large-chunk warning remains).
- [x] Start the client dev server on an available local port and use the official Playwright CLI to verify desktop and iPhone-sized login viewports.
- [ ] Verify login form labels/errors/loading, authenticated shell navigation, mobile navigation, delete confirmation keyboard flow, and at least one file/search state with screenshots or DOM evidence.
- [x] Separate migration failures from pre-existing repository failures; no migration test, typecheck, or build failure was observed. Authenticated browser states remain unrun without a session.
- [x] Review `git diff --check`, `git diff --stat`, and `git status --short`; unrelated pre-existing worktree changes were preserved.

## Completion Criteria

- [x] Generic client UI renders through `@oxygen-design/ui` or thin adapters backed by it.
- [x] Existing client behavior tests, typecheck, and production build pass, or any baseline failures are explicitly documented.
- [x] Desktop and mobile login browser checks show no clipping, overlap, or inaccessible primary actions; authenticated shell/dialog browser checks remain a documented gap.
- [ ] No commit, push, publish, or unrelated cleanup is performed without a new explicit user instruction.
