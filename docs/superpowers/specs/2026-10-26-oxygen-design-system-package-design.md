# Oxygen Design System 私有包设计

## 目标

建立独立的 GitHub 私有仓库 `oxygen-design-system`，开发并发布私有 npm 包 `@oxygen-design/ui`。该包向多个项目提供统一的 React 基础组件、无业务语义的页面模式、预编译组件样式和框架无关设计令牌。

知识库客户端是第一个消费项目，但不拥有共享 UI 源码。搜索、文件、上传、团队、Supabase 等业务逻辑继续留在知识库仓库。

## 已确认决策

- 使用独立 Git 仓库，不将共享 UI 长期放在知识库 monorepo。
- GitHub 仓库为私有仓库，名称为 `oxygen-design-system`。
- npm Organization 使用 `oxygen-design`，包名为 `@oxygen-design/ui`。
- npm 包使用 Organization 私有包，访问级别固定为 `restricted`。
- 包含基础组件和通用页面模式，不包含知识库业务组件。
- 发布 React 组件、预编译 CSS 和独立设计令牌。
- Tailwind CSS 仅作为 UI 仓库内部构建工具，不要求消费项目安装 Tailwind。
- 使用 Storybook 作为组件文档和视觉预览环境。
- 使用 Changesets 和 GitHub Actions 管理版本与发布。
- 知识库通过正式包版本消费，不长期依赖软链接、源码路径或本地 workspace。

## 前置准备

在开始发布前，由所有者完成以下外部账户操作：

1. 在 npm 创建 Organization `oxygen-design`，确认该名称可用并具备私有包权限。
2. 在 GitHub 创建私有仓库 `oxygen-design-system`。
3. 将 npm Organization 与 GitHub Actions 的发布权限限制到 `@oxygen-design/ui`。
4. 为消费仓库配置只读安装权限。

Codex 不在没有明确授权的情况下创建组织、仓库、token、secret 或外部发布记录。任何凭据都不得写入源码、文档、测试、日志或提交记录。

## 仓库结构

新仓库采用 pnpm workspace：

```text
oxygen-design-system/
├── apps/
│   └── storybook/
│       ├── .storybook/
│       ├── stories/
│       └── package.json
├── packages/
│   └── ui/
│       ├── src/
│       │   ├── components/
│       │   ├── patterns/
│       │   ├── styles/
│       │   └── index.ts
│       ├── tests/
│       ├── package.json
│       └── tsconfig.json
├── .changeset/
├── .github/workflows/
├── package.json
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

根 package 设为 `private: true`，只负责 workspace 脚本、开发工具和发布编排。只有 `packages/ui` 可以发布。

## 包边界

### 基础组件

首个版本提供以下 shadcn/Radix 风格组件：

- `Button`
- `Input`
- `Label`
- `Field`
- `FieldError`
- `Card`
- `Badge`
- `Alert`
- `Checkbox`
- `AlertDialog`
- `DropdownMenu`
- `Tabs`
- `Sheet`
- `Tooltip`

基础组件提供稳定的 TypeScript props、键盘交互、焦点管理、禁用态和可访问性语义。包从根入口显式转发首批原始 Lucide 组件名：`Check`、`ChevronDown`、`Clock3`、`Eye`、`EyeOff`、`Files`、`Menu`、`RefreshCw`、`Search`、`Settings`、`Trash2`、`Upload`、`Users`、`X`。这些是精选的原始图标导出，不封装业务图标名称，也不暴露整个 Lucide 命名空间。

### 通用页面模式

首个版本提供不含业务概念的组合组件：

- `PageHeader`：标题、说明和操作区插槽。
- `EmptyState`：图标、标题、说明和操作插槽。
- `StatusMessage`：`info`、`success`、`warning`、`error` 状态与可恢复操作。
- `AppShell`：桌面侧栏、移动顶部栏、移动导航和内容区插槽。

模式组件只定义布局和可访问行为，不包含路由、数据请求、权限判断、Supabase client 或业务状态机。

### 明确排除

以下内容不得进入共享包：

- 登录、注册或 session 服务。
- 搜索、上传、文件、团队、回收站等领域模型。
- Supabase 配置和数据访问。
- 项目路由和页面入口。
- 消费项目专属文案、权限或错误映射。
- 面向单一页面的一次性布局。

## 公共 API

包导出三个稳定入口：

```ts
import {
  AlertDialog,
  AppShell,
  Button,
  EmptyState,
  Input,
  PageHeader,
  StatusMessage
} from '@oxygen-design/ui';

import '@oxygen-design/ui/styles.css';
```

框架无关项目可以只消费令牌：

```css
@import '@oxygen-design/ui/tokens.css';
```

`package.json` 使用显式 exports：

```json
{
  "name": "@oxygen-design/ui",
  "version": "0.0.0",
  "type": "module",
  "files": ["dist"],
  "sideEffects": ["**/*.css"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles.css": "./dist/styles.css",
    "./tokens.css": "./dist/tokens.css"
  },
  "publishConfig": {
    "access": "restricted",
    "registry": "https://registry.npmjs.org/"
  },
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18"
  }
}
```

React 和 React DOM 只能作为 peer dependency，防止消费应用加载重复 React 实例。Radix、CVA、Lucide 和组件运行所需工具由包自身声明。

## 样式与隔离

### 分发模型

- `styles.css` 是组件与模式所需的预编译 CSS。
- `tokens.css` 只包含框架无关的设计变量。
- 消费项目不需要安装 Tailwind，也不需要扫描 `node_modules`。
- 包不发布全局 reset 或 preflight，不覆盖消费项目的 `body`、标题、表单控件和链接默认样式。

### 命名空间

所有设计变量使用 `--oxygen-*` 前缀，例如：

```css
:root {
  --oxygen-color-background: oklch(0.97 0.004 250);
  --oxygen-color-surface: oklch(1 0 0);
  --oxygen-color-primary: oklch(0.55 0.14 250);
  --oxygen-radius-control: 6px;
  --oxygen-radius-surface: 8px;
  --oxygen-control-height: 40px;
}
```

Tailwind 生成的组件类使用 Oxygen 前缀。组件样式放入明确的 CSS layer，避免与消费项目的工具类、主题变量或普通类名发生冲突。

### 主题覆盖

消费项目通过覆盖 `--oxygen-*` 变量定制品牌色，不修改组件源码：

```css
:root {
  --oxygen-color-primary: oklch(0.58 0.16 250);
}
```

首个版本只提供已确认的浅色中性主题。暗黑模式不在首发范围，但语义令牌不得阻止未来增加暗色主题。

## 视觉基线

- 使用 `4px` 基础间距网格，常用间距为 `4 / 8 / 12 / 16 / 24 / 32px`。
- 正文为 `14px / 20px`，辅助文字为 `12px / 18px`，表单标签为 `13px / 20px`。
- 区块标题为 `16px / 24px`，页面标题为桌面 `24px / 32px`、手机 `20px / 28px`。
- 桌面控件高度为 `40px`，移动端主要操作和图标按钮至少为 `44px`。
- 控件圆角为 `6px`，卡片与对话框圆角为 `8px`。
- 常规图标为 `16px`，主要操作图标为 `18px`。
- 使用冷灰背景、中性白表面、稳定蓝色主操作，以及独立的成功、警告和错误色。
- 不使用负字距、视口缩放字号、装饰性渐变、模糊光斑或大圆角悬浮页面卡片。

## 构建

UI 包构建产物必须包含：

- ESM JavaScript。
- TypeScript declaration files。
- `styles.css`。
- `tokens.css`。
- 完整且最小化的 `package.json` 导出信息。

构建过程将 React 和 React DOM 标记为 external。构建后的 tarball 不包含 Storybook、测试、源映射中的本地绝对路径、开发配置或凭据。

使用 Vite library mode 构建 ESM 与组件 CSS，使用声明文件插件生成 TypeScript declarations，并在 Vite/Rollup 配置中将 React 和 React DOM 标记为 external。Tailwind CSS v4 的 Vite 插件生成带 Oxygen 前缀的 CSS，`cssFileName` 固定为 `styles`。具体工具版本以实施时 npm registry 和官方文档验证结果为准，不在设计文档中固定可能过期的版本号。

## Storybook

Storybook 通过 workspace 依赖消费 `@oxygen-design/ui`，覆盖：

- 每个基础组件的默认、禁用、错误、加载和长文本状态。
- Dialog、Dropdown、Tabs、Sheet 和 Tooltip 的键盘交互。
- PageHeader、EmptyState、StatusMessage 和 AppShell 的桌面与移动状态。
- 冷灰浅色主题与 CSS 变量覆盖示例。
- 中文和英文长文案的溢出检查。

Storybook 是本地开发工具和 CI 构建产物。首个版本不默认部署为公开站点，避免私有组件文档意外暴露。

## 测试

### 单元与组件测试

使用 Vitest 和 Testing Library 验证：

- props、ref 和原生属性透传。
- 组件变体和禁用状态。
- 表单标签、错误描述与 `aria-invalid` 关联。
- Dialog、Dropdown、Tabs、Sheet 和 Tooltip 的键盘操作。
- 弹窗焦点锁定、关闭和焦点恢复。
- 通用模式的插槽、长文本和空操作状态。

### Storybook 与浏览器验证

- Storybook 必须成功构建。
- 使用 Storybook interaction tests 或等效浏览器检查验证关键交互。
- 使用桌面和 iPhone 视口检查文字溢出、控件遮挡、触控尺寸和响应式布局。
- 测试产物和截图不得包含 token 或私有 registry 凭据。

### 包消费验证

CI 运行 `pnpm pack`，并在最小 React 示例中安装生成的 tarball，验证：

- ESM import 可用。
- TypeScript 类型可解析。
- `styles.css` 可加载。
- `tokens.css` 可单独加载。
- 生产构建不依赖 UI 仓库源码路径、workspace 软链接或未声明依赖。

## 版本与发布

### 版本策略

- 开发阶段 manifest 版本为 `0.0.0`，首个 minor changeset 生成首发版本 `0.1.0`。
- 修复样式、类型或兼容问题使用 `patch` changeset。
- 新增向后兼容组件、模式或 props 使用 `minor` changeset。
- 删除、重命名或改变既有 API 使用 `major` changeset。
- 公共 API 和消费流程稳定后发布 `1.0.0`。

### Pull Request 检查

每个 Pull Request 必须通过：

1. 冻结锁文件安装。
2. TypeScript 检查。
3. Vitest 和 Testing Library。
4. UI 包构建。
5. Storybook 构建。
6. tarball 内容检查。
7. 最小消费示例 smoke test。

### Changesets 发布流程

1. 影响公共包的 Pull Request 必须包含 changeset。
2. 主分支由 Changesets Action 创建或更新版本 Pull Request。
3. 版本 Pull Request 显示版本号和 changelog，单独审阅。
4. 合并版本 Pull Request 后，GitHub Actions 发布 `@oxygen-design/ui`。
5. 发布失败不得修改或覆盖已经存在的版本号。

### 发布凭据

优先使用 npm Trusted Publishing/OIDC。若 npm Organization 的实际账号条件不支持，则使用仅允许发布 `@oxygen-design/ui` 的 granular access token。

凭据只存在于 npm trusted publisher 配置或 GitHub Actions secret。仓库中的 `.npmrc` 只能包含 registry 和环境变量引用，不能包含实际 token。

## 知识库接入

知识库作为首个消费项目，按以下顺序迁移：

1. 在 Oxygen Design System 仓库完成首批组件、模式、测试和构建。
2. 生成真实 npm tarball。
3. 在知识库中临时安装 tarball，验证类型、CSS、交互和生产构建。
4. 发布 `@oxygen-design/ui@0.1.0`。
5. 知识库改为安装精确版本 `@oxygen-design/ui: "0.1.0"`。
6. 逐块迁移登录、应用壳层、工作台、文件详情、团队和回收站。
7. 每迁移一个区域，删除对应的本地重复基础组件和旧样式。
8. 验证桌面与 iPhone 关键流程。
9. 确认最终构建不依赖 tarball、本地路径、软链接或 UI 仓库源码。

`1.0.0` 前使用精确版本，避免 `0.x` 兼容变化自动进入消费项目。稳定后再决定是否使用 `^1.x`。

## 安全与访问控制

- `publishConfig.access` 固定为 `restricted`。
- npm 发布身份只拥有目标包发布权限。
- 消费项目使用只读安装权限。
- GitHub 仓库权限与 npm 包权限分开管理。
- PR 日志、Storybook、测试 fixture 和 tarball 不得包含 npm token、GitHub token 或 `.npmrc` 认证内容。
- 发布工作流不得接受来自不受信任 fork 的 secret。
- 任何公开 Storybook 部署或公开 npm 访问级别变更都需要新的明确确认。

## 验收标准

1. `oxygen-design-system` 是独立 GitHub 私有仓库，不依赖知识库源码。
2. `@oxygen-design/ui` 只包含基础组件、通用模式、样式和令牌。
3. 消费项目不安装 Tailwind 也能使用组件样式。
4. 非 React 项目能够单独使用 `tokens.css`。
5. React 和 React DOM 不被打包进发布产物。
6. CSS 类名和变量具有 Oxygen 命名空间，且没有全局 reset。
7. Storybook 覆盖组件、模式、长文本和桌面/移动状态。
8. Pull Request 检查、Changesets 版本 PR 和私有 npm 发布流程可复现。
9. tarball smoke test 证明导出、类型、CSS 和依赖声明完整。
10. 知识库通过正式版本消费包，最终不存在本地软链接或源码路径依赖。
11. 所有凭据均位于受控 secret 或 trusted publisher 配置中。
12. 未经明确授权不创建外部组织、仓库、token、发布或公开文档站点。
