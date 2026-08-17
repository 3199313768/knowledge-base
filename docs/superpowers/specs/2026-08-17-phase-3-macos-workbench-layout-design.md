# Phase 3 macOS 工具 App 工作台布局设计

本次改版将登录后的主界面从单页功能堆叠，调整为 macOS Finder / 设置 App 风格的工作台。目标是稳定后续 Phase 3 的信息架构：资料、搜索、上传、设置都能放进统一壳子，而不是每新增一个功能就在当前页面继续堆组件。

## 范围

- 只改登录后的主工作台布局。
- 登录页保留现有结构和文案。
- 当前默认页面为“资料”。
- 左侧增加 App 导航：资料、搜索、上传、设置。
- 团队选择保留在左侧侧边栏。
- 账号和“退出当前设备”移到底部账户区。
- 右侧增加资料页标题区、状态栏、上传工具区和文件列表。
- 新增少量 `components/ui` 基础组件，沉淀按钮、卡片、徽标、输入框样式入口。

## 非范围

- 不新增真实页面路由。
- 不新增搜索功能。
- 不新增下载、预览、删除、重试。
- 不改 Supabase 查询、上传、认证业务逻辑。
- 不引入新依赖。

## 布局

外层：

- `.shell`：全屏浅灰桌面背景。
- `.app-frame`：macOS 窗口感容器，圆角、弱边框、低阴影。

左侧：

- 品牌区：图标、知识库、Mac + iPhone 文案。
- 主导航：资料、搜索、上传、设置。当前只作为信息架构展示，不切换真实页面。
- 团队区：现有 `WorkspacePanel`。
- 底部账户区：当前账号和“退出当前设备”。

右侧：

- 顶部栏：当前页面标题“资料”、当前团队状态。
- 状态卡片：文件总数、待处理、可搜索、失败。
- 主内容：上传入口压缩为工具卡，文件列表作为主要内容。
- 未选择团队时显示明确空状态：先选择或创建团队。

## 组件边界

`apps/client/src/components/ui/Button.tsx`

- 通用按钮组件，统一 `button`、`button--primary`、`button--ghost`、`button--link`。

`apps/client/src/components/ui/Card.tsx`

- 通用卡片容器，用于上传、列表、状态卡。

`apps/client/src/components/ui/Badge.tsx`

- 通用状态徽标。

`apps/client/src/components/ui/TextInput.tsx`

- 通用文本输入，供团队创建继续使用。

`apps/client/src/components/AppSidebar.tsx`

- 登录后左侧导航和账户区。
- 不访问 Supabase。

`apps/client/src/components/WorkspaceDashboard.tsx`

- 右侧资料页组合。
- 接收当前团队、文件状态、上传服务回调。

## 测试

- App 级测试覆盖侧边栏导航、默认资料页、账户区退出。
- 现有上传、团队、文件列表测试继续通过。
- 完成前运行客户端单测、TypeScript 和 build。

