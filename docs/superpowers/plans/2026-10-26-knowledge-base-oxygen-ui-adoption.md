# Knowledge Base Oxygen UI Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the knowledge-base client's local UI primitives and inconsistent page styling with the private `@oxygen-design/ui` package while preserving all authentication, workspace, search, upload, file, and recycle-bin behavior.

**Architecture:** Keep every existing service and domain hook in the knowledge-base repository. Install an exact private package version, migrate business components incrementally to shared primitives and generic patterns, retain only business layout CSS locally, and remove local duplicate UI primitives after all callers move.

**Tech Stack:** React 19, TypeScript, Vite, React Hook Form, `@oxygen-design/ui`, Supabase client, Vitest, Testing Library, Playwright/browser verification, pnpm.

## Global Constraints

- Prerequisite: the Oxygen package plan has passed locally and `@oxygen-design/ui@0.1.0` is available to the authenticated consumer, or a knowledge-base smoke check is being run in an isolated temporary copy with the real tarball.
- Preserve all existing uncommitted work in the knowledge-base repository.
- Current baseline is 17 test files and 151 tests passing; `pnpm --dir apps/client typecheck` also passes.
- Do not change Supabase configuration, auth contracts, workspace services, search services, upload services, file services, recycle-bin services, or database policies.
- Do not expose npm tokens, Supabase tokens, `.env` values, request headers, SQL, or raw backend errors.
- Use the exact package version `@oxygen-design/ui@0.1.0` until the package reaches `1.0.0`.
- Import `@oxygen-design/ui/styles.css` once at the application entry.
- Do not install Radix, CVA, Lucide, or Tailwind component sources directly in the knowledge-base client when the shared package owns them.
- Mac and iPhone share business components; layout differences may use CSS and the shared responsive patterns.
- Keep body text `14px/20px`, desktop controls `40px`, mobile targets at least `44px`, `6px` control radii, and `8px` surface radii.
- Do not add dark mode, password reset, third-party auth, invitation handling, all-device sign-out, or new business features.
- Do not commit, push, publish, deploy, or mutate cloud data without explicit authorization.
- Each task starts from focused failing tests and ends with tests, typecheck where relevant, and diff review.

---

## File Map

### Package Adoption

- Modify `apps/client/package.json`: add exact `@oxygen-design/ui` dependency.
- Modify `pnpm-lock.yaml`: lock authenticated private package.
- Modify `apps/client/src/main.tsx`: import shared `styles.css` once.
- Modify `apps/client/src/App.css`: retain only application/business layout styles and Oxygen token overrides.

### Authentication And Shell

- Modify `apps/client/src/App.tsx`: use shared surface/status components.
- Modify `apps/client/src/components/AuthCard.tsx`: use shared form and feedback components.
- Modify `apps/client/src/components/AppSidebar.tsx`: import curated Lucide icons from `@oxygen-design/ui` and use the shared account menu.
- Modify `apps/client/src/components/MainShell.tsx`: compose shared `AppShell`.
- Create `apps/client/src/components/AppNavigation.tsx`: one business navigation definition reused by desktop and mobile slots.

### Workbench And Files

- Modify `SearchPanel.tsx`, `SearchHistory.tsx`, `SearchResults.tsx`, `SearchResultItem.tsx`.
- Modify `UploadPanel.tsx`, `BatchOperationSummary.tsx`.
- Modify `FileStatusCenter.tsx`, `FileListPanel.tsx`, `WorkspaceDashboard.tsx`.
- Modify `FileInspector.tsx`.
- Create `DeleteFileDialog.tsx`: controlled soft-delete confirmation using shared AlertDialog.

### Teams, Recycle Bin, And Cleanup

- Modify `WorkspacePanel.tsx`, `TeamsPage.tsx`, `RecycleBinPage.tsx`, `DeleteConfirmationDialog.tsx`, `PlaceholderPage.tsx`.
- Remove local `components/ui` files only after `rg` proves there are no imports.
- Update colocated tests and `App.test.tsx` throughout.

---

### Task 1: Verify The Package Against The Dirty Client And Install The Exact Release

**Files:**
- Modify: `apps/client/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/client/src/main.tsx`
- Test: `apps/client/src/OxygenPackage.test.tsx`

**Interfaces:**
- Consumes: `@oxygen-design/ui@0.1.0`, `@oxygen-design/ui/styles.css`, authenticated read-only npm access.
- Produces: one client-wide style import and proof that public package exports render and typecheck in the actual client toolchain.

- [ ] **Step 1: Record the dirty-worktree and baseline state**

Run:

```bash
git status --short
pnpm --dir apps/client test:unit
pnpm --dir apps/client typecheck
```

Expected: preserve the status output; baseline remains 17 test files and 151 tests passing, with typecheck exit code 0. If the baseline changed since plan creation, record the current verified baseline before editing.

- [ ] **Step 2: Verify the real tarball in a temporary copy before publication**

When the shared package is not yet published, create a temporary directory with `mktemp -d`, copy the knowledge-base repository into it while excluding `.git`, `node_modules`, `dist`, and Rust targets, install the real tarball only in that copy, then run:

```bash
pnpm --dir apps/client test:unit
pnpm --dir apps/client typecheck
pnpm --dir apps/client build
```

Expected: PASS against the current dirty source snapshot. Do not modify or restore the real dirty `package.json`/lockfile for this pre-publication check.

- [ ] **Step 3: Write the failing public-export smoke test**

Create `apps/client/src/OxygenPackage.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, EmptyState } from '@oxygen-design/ui';

describe('@oxygen-design/ui consumer contract', () => {
  it('renders public components without internal source imports', () => {
    render(
      <EmptyState
        title="暂无内容"
        description="共享组件已接入"
        action={<Button>新建</Button>}
      />
    );

    expect(screen.getByRole('heading', { name: '暂无内容' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Confirm the test fails before installation**

Run:

```bash
pnpm --dir apps/client test:unit -- src/OxygenPackage.test.tsx
```

Expected: FAIL because `@oxygen-design/ui` cannot be resolved.

- [ ] **Step 5: Install the authenticated exact private version**

After `0.1.0` is published and npm read access is configured outside source control:

```bash
pnpm --dir apps/client add @oxygen-design/ui@0.1.0 --save-exact
```

Inspect the existing dirty `package.json` and `pnpm-lock.yaml` before and after; preserve unrelated entries and the existing React Hook Form changes.

- [ ] **Step 6: Import shared styles once**

In `apps/client/src/main.tsx`, import in this order:

```ts
import '@oxygen-design/ui/styles.css';
import './App.css';
```

Do not import shared styles from individual components.

- [ ] **Step 7: Verify package adoption**

Run:

```bash
pnpm --dir apps/client test:unit -- src/OxygenPackage.test.tsx
pnpm --dir apps/client typecheck
pnpm --dir apps/client build
git diff --check
```

Expected: PASS; the production build resolves only published exports; no registry credential appears in the diff.

---

### Task 2: Migrate Authentication To Shared Form And Feedback Components

**Files:**
- Modify: `apps/client/src/App.tsx`
- Modify: `apps/client/src/components/AuthCard.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: shared `Alert`, `Button`, `Card`, `Field`, `FieldError`, `Input`, `Label`, and `Tooltip`; existing `AuthCardProps`, auth service, and React Hook Form state.
- Produces: unchanged `AuthCard(props)` behavior with shared UI primitives and no local TextInput/Card/Button dependency.

- [ ] **Step 1: Add failing package-boundary assertions**

Keep all existing auth behavior tests and add:

```tsx
it('uses the shared semantic field and status contract', async () => {
  const { authService } = createAuthService();
  render(<App authService={authService} />);
  await screen.findByRole('heading', { name: '欢迎回来' });

  fireEvent.click(screen.getByRole('button', { name: '登录' }));

  const emailError = await screen.findByText('请输入邮箱');
  expect(emailError).toHaveAttribute('role', 'alert');
  expect(screen.getByLabelText('邮箱')).toHaveAccessibleDescription('请输入邮箱');
});
```

Update the password-toggle test to require an icon button with the same accessible names `显示密码` and `隐藏密码`; do not assert internal icon SVG paths or classes.

- [ ] **Step 2: Run auth tests and confirm the new field contract fails**

Run:

```bash
pnpm --dir apps/client test:unit -- src/App.test.tsx
```

Expected: FAIL until the shared Field/FieldError markup is used.

- [ ] **Step 3: Replace local primitives in AuthCard**

Use shared components and preserve these exact service inputs:

```ts
const credentials = { email: email.trim(), password };
```

Keep mode switching, `needsEmailConfirmation`, service retry, `isSubmitting`, `isSigningOut`, duplicate-submit protection, and current-device sign-out unchanged. Use a shared `Alert tone="error"` for service errors and `StatusMessage tone="success"` for email confirmation.

- [ ] **Step 4: Replace the loading card in App**

Use shared `Card` and `StatusMessage` while keeping the visible text `正在读取当前设备会话…` and `role="status"` behavior.

- [ ] **Step 5: Remove only auth-specific duplicate control CSS**

Delete local `.button`, `.text-input`, `.field input`, and Card-base rules only if no remaining business component still depends on them. Until later tasks complete, scope removal to auth selectors and leave temporary local primitive styles in place.

- [ ] **Step 6: Verify authentication**

Run:

```bash
pnpm --dir apps/client test:unit -- src/App.test.tsx
pnpm --dir apps/client typecheck
git diff --check
```

Expected: all auth tests pass; auth service files and Supabase client have no diff.

---

### Task 3: Migrate The Application Shell, Navigation, And Account Menu

**Files:**
- Create: `apps/client/src/components/AppNavigation.tsx`
- Modify: `apps/client/src/components/AppSidebar.tsx`
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: shared `AppShell`, `Button`, `DropdownMenu`, `Sheet`, Tooltip/icon-button contract; existing `SidebarSection` and `onNavigate` callback.
- Produces: one `navigationItems` definition, desktop sidebar, mobile Sheet navigation, and current-device account menu with unchanged section state.

- [ ] **Step 1: Add failing navigation and account-menu tests**

Add integration assertions:

```tsx
expect(screen.getAllByRole('navigation', { name: '应用导航' }).length).toBeGreaterThan(0);
fireEvent.click(screen.getByRole('button', { name: '账号菜单' }));
expect(screen.getByRole('menuitem', { name: '退出当前设备' })).toBeInTheDocument();
```

Add a mobile-navigation assertion using the shared trigger name `打开导航`, then choose `回收站` and verify the `回收站` page heading appears. When both desktop and mobile navigation exist in the DOM, scope assertions to the opened dialog rather than using global duplicate text selectors.

- [ ] **Step 2: Run the focused App tests and confirm they fail**

Run:

```bash
pnpm --dir apps/client test:unit -- src/App.test.tsx
```

Expected: FAIL because there is no account DropdownMenu or mobile navigation trigger.

- [ ] **Step 3: Extract one business navigation definition**

`AppNavigation.tsx` owns:

```ts
export type SidebarSection = 'files' | 'recent' | 'recycle' | 'teams' | 'settings';

export const navigationItems = [
  { id: 'files', label: '所有文件', icon: Files },
  { id: 'recent', label: '最近使用', icon: Clock3 },
  { id: 'recycle', label: '回收站', icon: Trash2 },
  { id: 'teams', label: '团队小组', icon: Users },
  { id: 'settings', label: '设置', icon: Settings }
] as const;
```

Import `Clock3`, `Files`, `Settings`, `Trash2`, and `Users` directly from the `@oxygen-design/ui` root export. Do not add `lucide-react` directly to the client. Scope mobile navigation assertions with `within(screen.getByRole('dialog'))` after opening the Sheet so duplicate desktop/mobile labels remain deterministic.

- [ ] **Step 4: Compose the shared AppShell**

`MainShell` passes desktop sidebar and mobile navigation slots to `AppShell`. `AppSidebar` renders brand, current team, navigation, and an account DropdownMenu. Selecting a mobile item closes the Sheet and calls the same `onNavigate(section)` callback.

- [ ] **Step 5: Normalize shell layout CSS**

Remove the floating `.app-frame` card appearance. Use a full-height shell, `240px` desktop sidebar, flexible content track, `24/20/16px` responsive content padding, and no page-section card nesting.

- [ ] **Step 6: Verify navigation and shell behavior**

Run:

```bash
pnpm --dir apps/client test:unit -- src/App.test.tsx
pnpm --dir apps/client typecheck
git diff --check
```

Expected: desktop navigation, mobile navigation, team entry, section selection, and current-device sign-out pass without changing auth or workspace services.

---

### Task 4: Migrate Search, Upload, Status Filters, And File List

**Files:**
- Modify: `apps/client/src/components/SearchPanel.tsx`
- Modify: `apps/client/src/components/SearchHistory.tsx`
- Modify: `apps/client/src/components/SearchResults.tsx`
- Modify: `apps/client/src/components/SearchResultItem.tsx`
- Modify: `apps/client/src/components/UploadPanel.tsx`
- Modify: `apps/client/src/components/BatchOperationSummary.tsx`
- Modify: `apps/client/src/components/FileStatusCenter.tsx`
- Modify: `apps/client/src/components/FileListPanel.tsx`
- Create: `apps/client/src/components/FileListPanel.test.tsx`
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`
- Modify: corresponding colocated tests
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: shared `Alert`, `Badge`, `Button`, `Checkbox`, `EmptyState`, `Input`, `StatusMessage`, `Tabs`, and Tooltip/icon button APIs; existing search/upload/file hooks.
- Produces: unchanged search, upload, filter, selection, retry, and batch callbacks rendered through shared UI.

- [ ] **Step 1: Add failing tests for the new semantic controls**

Update `FileStatusCenter.test.tsx` to query status filters as tabs:

```tsx
const failedFilter = screen.getByRole('tab', { name: '失败 1' });
fireEvent.click(failedFilter);
expect(onFilterChange).toHaveBeenCalledWith('failed');
```

Add a `FileListPanel.test.tsx` regression that selects a file through a named Checkbox and confirms batch buttons enable without depending on `<input>` DOM structure.

Keep existing SearchPanel, SearchHistory, SearchResults, upload hook, stale-response, blank-query, and workspace-switch tests unchanged.

- [ ] **Step 2: Run the focused component tests and confirm the new semantics fail**

Run:

```bash
pnpm --dir apps/client test:unit -- src/components/SearchPanel.test.tsx src/components/SearchHistory.test.tsx src/components/SearchResults.test.tsx src/components/FileStatusCenter.test.tsx src/components/FileListPanel.test.tsx
```

Expected: new Tabs/Checkbox expectations fail while existing behavior tests remain green.

- [ ] **Step 3: Migrate search and history surfaces**

Use shared Input/Button for the search command. Use `StatusMessage` for loading and errors, `EmptyState` for no results, and compact shared Buttons for history chips. Preserve all error kinds and retry callback conditions.

- [ ] **Step 4: Migrate upload surfaces**

Use shared Button and StatusMessage; keep the native hidden file input, accepted MIME types, multiple selection, drag-depth handling, single/batch branching, duplicate outcomes, and disabled state. Import `Upload` from `@oxygen-design/ui` and use it rather than `↑`; do not add a direct Lucide dependency.

- [ ] **Step 5: Migrate status filters to controlled Tabs**

Map `FileStatusFilter` values directly to Tabs values:

```ts
onValueChange={(value) => onFilterChange(value as FileStatusFilter)}
```

Do not move filtering into the shared Tabs component. Keep retry tokens and per-file outcomes in `FileStatusCenter`.

- [ ] **Step 6: Migrate list selection and batch controls**

Replace native visual checkbox markup with shared Checkbox while preserving a visible accessible name `选择 ${file.displayName}`. Keep the Set-based selection and batch-service calls. Use fixed grid tracks for selection, name, status, and size so badges and loading labels cannot shift row geometry.

- [ ] **Step 7: Remove nested cards from WorkspaceDashboard**

Use PageHeader/EmptyState/StatusMessage patterns where appropriate. File rows may remain individually framed; status center and page sections must not become cards nested inside a file-list card.

- [ ] **Step 8: Verify workbench behavior**

Run:

```bash
pnpm --dir apps/client test:unit -- src/components/SearchPanel.test.tsx src/components/SearchHistory.test.tsx src/components/SearchResults.test.tsx src/components/FileStatusCenter.test.tsx src/components/FileListPanel.test.tsx src/App.test.tsx
pnpm --dir apps/client typecheck
git diff --check
```

Expected: search-to-file opening, upload refresh, filtering, retry, selection, and batch behavior all pass.

---

### Task 5: Migrate File Details And Both Delete Confirmations

**Files:**
- Create: `apps/client/src/components/DeleteFileDialog.tsx`
- Modify: `apps/client/src/components/FileInspector.tsx`
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`
- Modify: `apps/client/src/components/MainShell.tsx`
- Modify: `apps/client/src/components/DeleteConfirmationDialog.tsx`
- Modify: `apps/client/src/components/FileInspector.test.tsx`
- Modify: `apps/client/src/components/RecycleBinPage.test.tsx`
- Modify: `apps/client/src/App.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: shared `Alert`, `AlertDialog`, `Badge`, `Button`, `Sheet`, `StatusMessage`; existing preview/retry/delete service callbacks.
- Produces: controlled soft-delete dialog, shared permanent-delete dialog, desktop inspector and mobile Sheet using the same `FileInspector` business component.

- [ ] **Step 1: Replace the native-confirm expectation with a failing dialog test**

In `App.test.tsx`, remove any `window.confirm` mock and assert:

```tsx
fireEvent.click(screen.getByRole('button', { name: '删除选中文件' }));
expect(screen.getByRole('alertdialog', { name: '删除文件？' })).toHaveTextContent('产品方案.pdf');
fireEvent.click(screen.getByRole('button', { name: '移入回收站' }));
await waitFor(() => expect(fileService.softDeleteFile).toHaveBeenCalledWith('file-a'));
```

Extend the recycle-bin test to confirm focus returns to the permanent-delete trigger after cancel.

- [ ] **Step 2: Run focused tests and confirm native/custom dialogs fail the new contract**

Run:

```bash
pnpm --dir apps/client test:unit -- src/components/FileInspector.test.tsx src/components/RecycleBinPage.test.tsx src/App.test.tsx
```

Expected: FAIL because soft delete still uses `window.confirm` and permanent delete still uses a custom overlay.

- [ ] **Step 3: Implement controlled DeleteFileDialog state**

Move soft-delete confirmation state into `MainShell` without changing `deleteFile(file)` generation-token checks. Add `deleteTarget: FileSummary | null` for the selected dialog target and `deletingFileId: string | null` for the in-flight item. Opening sets only `deleteTarget`; confirming sets `deletingFileId`, awaits the existing token-safe delete path, and clears both values only after success. A failure clears `deletingFileId` but keeps `deleteTarget` open so the user can retry. The dialog receives:

```ts
interface DeleteFileDialogProps {
  file: FileSummary | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: (file: FileSummary) => Promise<void>;
}
```

The confirm label is `移入回收站`; duplicate confirmation is disabled while pending. Cancel clears only the dialog target.

- [ ] **Step 4: Migrate FileInspector controls and statuses**

Use shared Badge, Button, Alert, and StatusMessage. Preserve PDF/DOCX branches, preview request tokens, retry request tokens, file-key guard, safe Chinese errors, and current accessible button names.

- [ ] **Step 5: Provide the mobile inspector Sheet**

Create `apps/client/src/lib/useMediaQuery.ts` and `useMediaQuery.test.ts`. Implement the hook with `useSyncExternalStore`, `window.matchMedia`, `addEventListener('change', ...)`, matching cleanup through `removeEventListener`, and an SSR snapshot of `false`. `WorkspaceDashboard` calls `useMediaQuery('(max-width: 820px)')`, keeps `isInspectorOpen` separate from `selectedFileId`, opens the Sheet only when a user selects a file in compact mode, and does not open it when the first file is auto-selected. Render exactly one `FileInspector`: inside the desktop `<aside>` when the query is false, or inside the shared Sheet when true. Closing the Sheet resets `isInspectorOpen` but retains the selected file.

- [ ] **Step 6: Replace permanent-delete overlay with shared AlertDialog**

Keep `DeleteConfirmationDialogProps` stable. Use `AlertDialogContent`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogCancel`, and `AlertDialogAction`; preserve `正在提交清理…` and `cleanup_pending` truthfulness.

- [ ] **Step 7: Verify file details and destructive flows**

Run:

```bash
pnpm --dir apps/client test:unit -- src/components/FileInspector.test.tsx src/components/RecycleBinPage.test.tsx src/App.test.tsx
pnpm --dir apps/client typecheck
git diff --check
```

Expected: no `window.confirm`, `.confirm-overlay`, or home-grown dialog role remains.

---

### Task 6: Migrate Teams, Workspace Creation, Recycle Bin, And Empty Pages

**Files:**
- Modify: `apps/client/src/components/WorkspacePanel.tsx`
- Modify: `apps/client/src/components/TeamsPage.tsx`
- Modify: `apps/client/src/components/RecycleBinPage.tsx`
- Modify: `apps/client/src/components/PlaceholderPage.tsx`
- Create: `apps/client/src/components/WorkspacePanel.test.tsx`
- Modify: `apps/client/src/components/RecycleBinPage.test.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: shared `Button`, `EmptyState`, `Field`, `FieldError`, `Input`, `Label`, `PageHeader`, `StatusMessage`; React Hook Form; existing workspace and recycle services.
- Produces: validated workspace form and shared-layout team/recycle/placeholder pages with unchanged service calls.

- [ ] **Step 1: Write failing workspace form tests**

Cover empty input, trimming, duplicate submission, service failure, cancel, and success reset:

```tsx
it('trims a team name and prevents duplicate submission', async () => {
  let resolveCreate!: () => void;
  const onCreateWorkspace = vi.fn(
    () => new Promise<void>((resolve) => { resolveCreate = resolve; })
  );

  render(<WorkspacePanel {...baseProps} onCreateWorkspace={onCreateWorkspace} />);
  fireEvent.change(screen.getByLabelText('团队名称'), {
    target: { value: '  产品知识库  ' }
  });
  fireEvent.click(screen.getByRole('button', { name: '创建团队' }));

  expect(onCreateWorkspace).toHaveBeenCalledWith('产品知识库');
  expect(screen.getByRole('button', { name: '正在创建…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '正在创建…' }));
  expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
  await act(async () => resolveCreate());
});
```

- [ ] **Step 2: Run the focused tests and confirm the new form contract fails**

Run:

```bash
pnpm --dir apps/client test:unit -- src/components/WorkspacePanel.test.tsx src/components/RecycleBinPage.test.tsx
```

Expected: FAIL because WorkspacePanel still uses local state and lacks field-level validation.

- [ ] **Step 3: Migrate WorkspacePanel to React Hook Form**

Use this form type and validation:

```ts
interface WorkspaceFormValues {
  name: string;
}

register('name', {
  required: '请输入团队名称',
  setValueAs: (value: string) => value.trim()
});
```

Disable inputs and actions while either React Hook Form or the parent reports creating. Clear and close only after `onCreateWorkspace` resolves. Keep the form open with a safe error on rejection.

- [ ] **Step 4: Migrate TeamsPage and PlaceholderPage**

Use PageHeader and unframed EmptyState. Remove Card-inside-page-section layout. Keep all visible copy Chinese and keep the toolbar `新建团队` action.

- [ ] **Step 5: Migrate RecycleBinPage feedback and list controls**

Use PageHeader, EmptyState, StatusMessage, and shared Buttons. Preserve request generation, pending ID exclusion, 30-day copy, restore refresh, retry, permanent delete, and `cleanup_pending` message.

- [ ] **Step 6: Verify team and recycle behavior**

Run:

```bash
pnpm --dir apps/client test:unit -- src/components/WorkspacePanel.test.tsx src/components/RecycleBinPage.test.tsx src/App.test.tsx
pnpm --dir apps/client typecheck
git diff --check
```

Expected: all service call arguments and concurrency protections remain unchanged.

---

### Task 7: Remove Duplicate Local UI, Normalize Styles, And Run Full Acceptance

**Files:**
- Remove only when unreferenced: `apps/client/src/components/ui/Button.tsx`
- Remove only when unreferenced: `apps/client/src/components/ui/TextInput.tsx`
- Remove only when unreferenced: `apps/client/src/components/ui/PasswordInput.tsx`
- Remove only when unreferenced: `apps/client/src/components/ui/Card.tsx`
- Remove only when unreferenced: `apps/client/src/components/ui/Badge.tsx`
- Modify: `apps/client/src/App.css`
- Modify: `apps/client/src/App.test.tsx` and any tests affected by final semantic cleanup

**Interfaces:**
- Consumes: all migrated business components and `@oxygen-design/ui/styles.css`.
- Produces: no duplicate primitive layer, application-only CSS, full automated verification, and desktop/iPhone browser evidence.

- [ ] **Step 1: Prove local primitives are unreferenced before removal**

Run:

```bash
rg -n "components/ui|./ui/|../ui/" apps/client/src
```

Expected: no application or test import references the local UI directory. If references remain, migrate those callers before deleting any file.

- [ ] **Step 2: Remove only proven-dead local UI files**

Delete the local primitive files listed above only after Step 1 is clean. Do not delete `lib/utils.ts` if another client module still uses `cn`.

- [ ] **Step 3: Reduce App.css to application and business layout**

Remove duplicate rules for `.button`, `.text-input`, `.ui-card`, `.badge`, dialog overlay, local field controls, and character icons. Retain only:

- auth page positioning and maximum width;
- shell/sidebar/business layout;
- workbench grids and responsive breakpoints;
- upload dropzone layout;
- file row/inspector/recycle business layout;
- narrowly scoped Oxygen token overrides.

Scan numeric values and align them to the approved spacing, typography, height, and radius scales.

- [ ] **Step 4: Run the complete automated verification chain**

Run:

```bash
pnpm --dir apps/client test:unit
pnpm --dir apps/client typecheck
pnpm --dir apps/client build
git diff --check
```

Expected: all client tests pass, typecheck passes, build passes, and diff check is silent. Report the final test count rather than assuming it remains 151 after new tests.

- [ ] **Step 5: Start the real client and verify desktop behavior**

Run:

```bash
pnpm --dir apps/client dev --host 127.0.0.1 --port 5174 --strictPort
```

Verify at a desktop viewport:

- auth loading, login, registration, validation, password toggle, and service error;
- sidebar navigation, account menu, current team, and current-device sign-out;
- search/history/results, upload/dropzone, status Tabs, file selection and batch actions;
- file preview/retry/delete dialog;
- teams, workspace creation, recycle restore, and permanent-delete dialog.

- [ ] **Step 6: Verify iPhone layout and interaction**

Use an iPhone-sized viewport and verify mobile top bar, navigation Sheet, minimum touch targets, single-column file layout, inspector Sheet, virtual-keyboard-safe forms, long names, dialogs, no horizontal scrolling, and no overlapping controls.

- [ ] **Step 7: Inspect rendered CSS and package ownership**

Confirm the production build includes `@oxygen-design/ui` styles, no local duplicate primitive selectors, and no Tailwind source scanning dependency. Verify the browser console has no missing CSS, duplicate React, hydration, focus, or uncontrolled-state warnings.

- [ ] **Step 8: Review the complete knowledge-base diff**

Run:

```bash
git status --short
git diff --stat
git diff -- apps/client package.json pnpm-lock.yaml
```

Expected: only intended client migration and dependency changes appear; existing unrelated dirty files remain preserved; no `.npmrc` token, tarball path, local UI repository path, build artifact, commit, push, deployment, or cloud mutation is present.

---

## Completion Boundary

This plan is complete only when the knowledge-base production build consumes the published exact package version, all automated checks pass, desktop and iPhone flows are verified in a real browser, and no local tarball/path/link remains.

The following remain separate evidence gates and must be reported as unrun unless explicitly authorized: deployed Supabase RLS, Storage permissions, worker processing, authenticated production data, npm Organization administration, package publication, and deployment.
