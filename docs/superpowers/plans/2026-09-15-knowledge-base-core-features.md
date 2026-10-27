# Knowledge Base Core Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成登录、文件上传、文件列表、关键词搜索、文件预览及统一错误/状态体验。

**Architecture:** 页面入口只组合业务组件；Supabase 访问集中在 service，状态和错误转换集中在 hook；展示组件只消费稳定 ViewModel。每个功能先补失败测试，再实现最小行为。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Testing Library、Supabase JS、现有 CSS/组件体系。

## Global Constraints

- 用户可见文案统一使用中文。
- 远程数据必须覆盖 loading、empty、error、success 状态。
- 错误不得暴露 SQL、Token、堆栈或密钥。
- 上传期间必须禁用重复提交，并保留失败后的用户输入和页面上下文。
- 不新增依赖；复用现有 service、hook 和基础组件。
- 每项行为先写失败测试，再写实现。

### Task 1: 认证失败态与登录恢复

**Files:**
- Modify: `apps/client/src/App.tsx`
- Modify: `apps/client/src/auth/useAuthSession.ts`
- Modify: `apps/client/src/components/AuthCard.tsx`
- Test: `apps/client/src/App.test.tsx`

- [ ] 为认证接口失败仍显示登录页、错误提示和“重试”按钮补测试。
- [ ] 运行 `pnpm test -- App.test.tsx`，确认测试先失败。
- [ ] 让认证 hook 暴露可重复执行的状态读取函数，并让 App 复用 AuthCard 错误态。
- [ ] 运行 `pnpm test -- App.test.tsx` 与 `pnpm typecheck`。

### Task 2: 文件服务与列表状态

**Files:**
- Review/Modify: `apps/client/src/files/fileService.ts`
- Review/Modify: `apps/client/src/files/useFiles.ts`
- Modify: `apps/client/src/components/MainShell.tsx`
- Test: `apps/client/src/files/fileService.test.ts`, `apps/client/src/files/useFiles.test.ts`, `apps/client/src/App.test.tsx`

- [ ] 补充文件 ViewModel 映射、状态文案、空列表和加载/错误测试。
- [ ] 运行对应 Vitest 测试确认失败。
- [ ] 保持 Supabase 查询只在 service 层，完善列表刷新、状态筛选和安全错误映射。
- [ ] 运行文件测试、`pnpm typecheck` 和客户端构建。

### Task 3: 文件上传

**Files:**
- Review/Modify: `apps/client/src/uploads/uploadService.ts`
- Review/Modify: `apps/client/src/uploads/useBatchUpload.ts`
- Modify: `apps/client/src/components/MainShell.tsx`
- Test: `apps/client/src/uploads/*.test.ts`, `apps/client/src/App.test.tsx`

- [ ] 为 PDF/DOCX 校验、上传中禁用、失败保留页面和安全错误补测试。
- [ ] 运行上传测试确认失败。
- [ ] 实现最小上传流程，完成后刷新文件列表，不清空当前上下文。
- [ ] 运行上传测试、类型检查和构建。

### Task 4: 关键词搜索与历史

**Files:**
- Review/Modify: `apps/client/src/search/searchService.ts`
- Review/Modify: `apps/client/src/search/useSearch.ts`
- Review/Modify: `apps/client/src/search/useSearchHistory.ts`
- Modify: `apps/client/src/components/MainShell.tsx`
- Test: `apps/client/src/search/*.test.ts`, `apps/client/src/App.test.tsx`

- [ ] 补充搜索中、无结果、失败、结果片段和历史记录测试。
- [ ] 运行搜索测试确认失败。
- [ ] 实现关键词查询、结果 ViewModel、历史记录和重试入口。
- [ ] 运行搜索测试、类型检查和构建。

### Task 5: 文件预览与处理失败重试

**Files:**
- Review/Modify: `apps/client/src/components/FileInspector.tsx`
- Review/Modify: `apps/client/src/files/fileService.ts`
- Modify: `apps/client/src/components/MainShell.tsx`
- Test: `apps/client/src/components/FileInspector.test.tsx`, `apps/client/src/App.test.tsx`

- [ ] 补充 PDF/DOCX 详情、处理中、解析失败和重新处理测试。
- [ ] 运行预览测试确认失败。
- [ ] 实现预览详情、失败原因展示和重试动作，保持权限/网络错误安全文案。
- [ ] 运行预览测试、类型检查和构建。

### Task 6: 全局状态与回归验证

**Files:**
- Modify: `apps/client/src/App.css`
- Review: `apps/client/src/App.tsx`, `apps/client/src/components/*`
- Test: `apps/client/src/**/*.test.ts`, `apps/client/src/**/*.test.tsx`

- [ ] 补充关键页面 loading、empty、error、success 的可访问性断言。
- [ ] 运行客户端完整测试确认基线。
- [ ] 统一状态样式、按钮禁用态和中文错误提示，不改变既有业务布局。
- [ ] 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。

