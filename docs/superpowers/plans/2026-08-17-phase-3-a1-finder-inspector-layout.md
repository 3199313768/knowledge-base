# Phase 3 A1 Finder Inspector Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Phase 3 工作台改成用户已确认的 A1 Balanced Finder 三栏布局。

**Architecture:** 保持现有 `MainShell`、`WorkspaceDashboard`、`FileListPanel`、`SearchPanel`、`UploadPanel` 服务边界不变，只调整组件组合和展示状态。新增 `FileInspector` 作为右侧只读/操作面板，由 `WorkspaceDashboard` 管理当前选中文件。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、CSS。

## Global Constraints

- 直接在 main 当前工作区改代码，不提交 Git。
- 文档和 UI 文案使用中文。
- 不引入新依赖。
- 不扩展 Phase 3 后端能力，只消费现有 `FileService`、`SearchService`、`UploadService`。

---

### Task 1: A1 布局行为测试

**Files:**
- Modify: `apps/client/src/App.test.tsx`

**Interfaces:**
- Consumes: existing `<App />` dependency injection props.
- Produces: tests that require A1 layout landmarks and selected-file inspector behavior.

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```tsx
expect(await screen.findByRole('region', { name: '资料工作区' })).toBeInTheDocument();
expect(screen.getByRole('complementary', { name: '文件检查器' })).toBeInTheDocument();
expect(screen.getByLabelText('搜索当前团队资料')).toBeInTheDocument();
expect(screen.getByLabelText('选择 PDF 或 DOCX')).toBeInTheDocument();
```

Add a selected-file test:

```tsx
fireEvent.click(screen.getByRole('button', { name: '查看 访谈记录.pdf' }));
expect(screen.getByRole('heading', { name: '访谈记录.pdf' })).toBeInTheDocument();
expect(screen.getByText('重新处理')).toBeInTheDocument();
```

- [ ] **Step 2: Run target tests and verify failure**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`

Expected: FAIL because the region/complementary landmarks and selected inspector are not implemented.

### Task 2: FileInspector and selected file state

**Files:**
- Create: `apps/client/src/components/FileInspector.tsx`
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`
- Modify: `apps/client/src/components/FileListPanel.tsx`

**Interfaces:**
- Consumes: `FileSummary`, `formatFileSize`, `formatFileStatus`.
- Produces: `FileInspector` props:

```ts
interface FileInspectorProps {
  file: FileSummary | null;
  onDeleteFile: (file: FileSummary) => Promise<void>;
  onRetryFile: (file: FileSummary) => Promise<void>;
}
```

- [ ] **Step 1: Implement selected state**

`WorkspaceDashboard` owns `selectedFileId`, derives `selectedFile`, defaults to first file, and clears stale selections after refresh/delete.

- [ ] **Step 2: Update file rows**

Rows become selectable buttons/rows with an explicit `查看 <filename>` action, active styling, and unchanged delete/retry actions.

- [ ] **Step 3: Implement inspector**

Inspector shows empty guidance, selected filename, status, size, version id, updated time, retry for failed files, delete, and an “打开详情” placeholder button.

### Task 3: A1 visual composition

**Files:**
- Modify: `apps/client/src/components/WorkspaceDashboard.tsx`
- Modify: `apps/client/src/components/SearchPanel.tsx`
- Modify: `apps/client/src/components/UploadPanel.tsx`
- Modify: `apps/client/src/App.css`

**Interfaces:**
- Consumes: existing `SearchPanel` and `UploadPanel` behavior.
- Produces: A1 CSS classes: `workbench-grid`, `workbench-main`, `workbench-toolbar`, `file-inspector`.

- [ ] **Step 1: Move search and upload into the main workbench flow**

Place search as top command area, upload as compact action panel under toolbar, file list as central table/card.

- [ ] **Step 2: Apply A1 styling**

Use three columns: sidebar / main / inspector. Keep the sidebar width stable, make the inspector 300–340px, make main scroll independently.

### Task 4: Verification

**Files:**
- Test: `apps/client/src/App.test.tsx`

- [ ] **Step 1: Run focused tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit -- src/App.test.tsx`

- [ ] **Step 2: Run full client tests**

Run: `env CI=true pnpm --filter knowledge-base test:unit`

- [ ] **Step 3: Run typecheck**

Run: `env CI=true pnpm --dir apps/client typecheck`

- [ ] **Step 4: Run build**

Run: `env CI=true pnpm --dir apps/client build`
