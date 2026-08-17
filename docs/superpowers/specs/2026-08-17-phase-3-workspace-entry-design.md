# Phase 3 团队/工作区入口设计

## 范围

本阶段在已登录主界面中增加“团队/工作区入口”。用户登录后先进入工作台壳，客户端读取当前账号可访问的 `workspaces`，没有团队时提供创建团队入口，有团队时允许选择当前团队。

本阶段不实现上传、搜索、成员邀请、权限管理、文件列表、离线队列或 iOS 分享扩展消费。

## 用户体验

已登录后显示：

- 当前账号邮箱。
- 当前团队选择区。
- 团队列表读取中状态。
- 没有团队时显示“还没有团队”和创建表单。
- 创建团队成功后自动选中新团队。
- 有团队时展示团队按钮列表，点击后切换当前团队。
- 退出当前设备按钮继续保留在主界面右上角。

主内容仍是占位区，但文案从“已进入当前设备会话”升级为“已选择团队后可以继续接入上传资料”。

## 数据流

读取团队：

1. 使用当前 Supabase authenticated session。
2. 查询 `workspaces` 表：`select id,name,created_at`，按 `created_at desc` 排序。
3. RLS 负责只返回当前用户可访问团队。

创建团队：

1. 表单输入团队名称，前端 trim。
2. 名称为空时前端拒绝。
3. 调用 RPC `create_workspace({ p_name })`。
4. 成功后重新读取团队列表并选中新团队。

## 模块边界

`apps/client/src/workspaces/workspaceService.ts`

- 只负责 Supabase workspace 查询与 RPC。
- 不持有 React 状态。

`apps/client/src/workspaces/useWorkspaces.ts`

- 负责加载状态、错误、当前团队选择、创建后刷新。
- 依赖 `WorkspaceService`，便于测试注入。

`apps/client/src/components/WorkspacePanel.tsx`

- 只负责团队列表、创建表单和选择 UI。

`apps/client/src/components/MainShell.tsx`

- 组合账号信息、退出按钮和 `WorkspacePanel`。

`apps/client/src/App.tsx`

- 只负责认证状态分发，并把 workspace service 注入到已登录主界面。

## 错误处理

- 团队列表读取失败：显示“读取团队失败”加真实错误 message。
- 创建团队失败：显示“创建团队失败”加真实错误 message。
- 团队名为空：显示“请输入团队名称”。
- 不暴露 Supabase service role key。

## 测试

- 登录成功后读取团队列表。
- 没有团队时显示创建入口。
- 创建团队成功后自动选中新团队。
- 有多个团队时可以切换当前团队。
- 团队读取失败时显示错误。
- 退出当前设备不受团队模块影响。
