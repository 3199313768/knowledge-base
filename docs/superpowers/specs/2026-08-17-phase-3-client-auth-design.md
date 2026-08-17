# Phase 3 客户端登录注册与当前设备退出设计

## 目标

Phase 3 先补客户端最小可用账号入口：Mac/iPhone 共用同一个 React 入口，支持邮箱+密码登录、注册新账号，以及“退出当前设备”。

## 范围

本阶段只做前端客户端认证壳，不实现文件上传、搜索、同步、工作区管理、处理状态通知或真实内容列表。

本阶段不接触 Supabase Service Role key。客户端只允许使用 Supabase URL 和 anon/publishable key。

## 用户体验

未登录时显示登录/注册卡片：

- 默认是“登录”模式。
- 用户可以切换到“注册新账号”模式。
- 两个模式都使用邮箱和密码。
- 表单提交期间按钮进入 loading 状态。
- 失败时在表单内展示错误信息。
- 如果本机已有会话，登录页右上角展示“退出当前设备”。

已登录时显示主界面壳：

- 顶部展示当前账号邮箱。
- 顶部提供“退出当前设备”按钮。
- 主内容只展示 Phase 3 占位文案，说明后续会接入知识库功能。

## 数据流

客户端初始化时：

1. 创建 Supabase browser client。
2. 调用 `supabase.auth.getSession()` 读取当前设备会话。
3. 订阅 `supabase.auth.onAuthStateChange()`，保持 UI 与本地 session 同步。
4. 组件卸载时调用 subscription cleanup。

登录：

1. 用户输入邮箱和密码。
2. 调用 `supabase.auth.signInWithPassword({ email, password })`。
3. 成功后由 auth state subscription 推动 UI 切到已登录主界面。

注册：

1. 用户输入邮箱和密码。
2. 调用 `supabase.auth.signUp({ email, password })`。
3. 如果项目开启邮箱确认，展示“请检查邮箱完成确认”的提示。
4. 如果返回 session，则进入已登录主界面。

退出当前设备：

1. 调用 `supabase.auth.signOut({ scope: 'local' })`。
2. 成功后清空当前 UI session，回到登录页。
3. 不退出其它设备或浏览器会话。

## 模块边界

`apps/client/src/lib/supabaseClient.ts`

- 只负责创建 Supabase client。
- 从 `import.meta.env.VITE_SUPABASE_URL` 和 `import.meta.env.VITE_SUPABASE_ANON_KEY` 读取非密钥配置。
- 缺失配置时返回可测试的错误，不打印 key 值。

`apps/client/src/auth/authService.ts`

- 封装 `getSession`、`onAuthStateChange`、`signInWithPassword`、`signUp`、`signOut({ scope: 'local' })`。
- UI 不直接拼 Supabase API 参数。

`apps/client/src/auth/useAuthSession.ts`

- React hook，管理 `session`、`isLoading`、`error`。
- 负责订阅和清理 auth state listener。

`apps/client/src/components/AuthCard.tsx`

- 登录/注册表单。
- 控制模式切换、表单校验、提交状态、错误提示。

`apps/client/src/components/MainShell.tsx`

- 登录后的主界面壳。
- 展示账号邮箱和退出当前设备按钮。

`apps/client/src/App.tsx`

- 只做应用状态分发：加载中、未登录、已登录。

## 错误处理

- 邮箱为空：提示“请输入邮箱”。
- 密码为空：提示“请输入密码”。
- 密码长度小于 6：提示“密码至少 6 位”。
- Supabase 返回错误：展示错误 message，但不展示 token、URL key 或底层请求详情。
- 环境变量缺失：页面展示“Supabase 客户端配置缺失”，不尝试发请求。

## 测试策略

本地单测覆盖：

- 默认展示登录页。
- 登录/注册模式切换。
- 登录成功后进入主界面。
- 注册成功且无 session 时展示邮箱确认提示。
- 已登录时主界面展示账号邮箱。
- 登录页和主界面都可以触发“退出当前设备”。
- auth state subscription 在组件卸载时清理。
- 缺失 Supabase 配置时展示安全错误。

验证命令：

```bash
pnpm --filter knowledge-base test:unit
pnpm --filter knowledge-base typecheck
```

必要时再运行根级本地门禁：

```bash
pnpm verify:phase-2-local
```

Phase 3 不是 Phase 1/2 云端门禁收口；不会把当前 Phase 1/2 云端失败算作本阶段失败。
