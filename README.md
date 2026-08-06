# Knowledge Base

Phase 0 技术验证仓库：在完整 MVP 之前，验证三条高风险假设——

1. 同一套 Tauri 2 + React 代码可在 **macOS 14+** 与 **iOS 17+** 运行
2. iOS Share Extension 可通过 **App Group** 与宿主交换 PDF / URL
3. 中文语义检索（pgvector + multilingual-e5-small）能召回预期文件

详细实施计划见本地文件 `outputs/knowledge-base-phase-0-technical-validation-plan.md`（该目录默认被 `.gitignore` 忽略）。

## 仓库结构

```text
.
├── apps/
│   ├── client/                 # Tauri 2 + React 客户端（Mac / iPhone）
│   │   ├── native/ios-share/   # Share Extension 稳定源码
│   │   └── src-tauri/gen/apple # Tauri 生成的 Xcode 工程
│   └── search-spike/           # 中文语义检索 spike（E5 + pgvector）
├── packages/
│   └── contracts/              # 搜索契约类型与校验
├── fixtures/search/            # 合成语料与评测查询
├── supabase/                   # 云端开发项目迁移与可选 pgTAP
├── validation/phase-0/         # 烟测与裁决证据
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## 平台身份

| 项 | 值 |
| --- | --- |
| 产品名 | `KnowledgeBase` |
| Bundle ID（宿主） | `com.local.knowledgebase` |
| Bundle ID（Share） | `com.local.knowledgebase.share` |
| App Group | `group.com.local.knowledgebase` |
| Xcode 工程 | `apps/client/src-tauri/gen/apple/knowledge-base.xcodeproj` |
| iOS scheme | `KnowledgeBase_iOS` / `knowledge-base_iOS` |
| Share 测试 scheme | `KnowledgeBaseShareTests` |
| 最低系统 | macOS 14.0 / iOS 17.0 |

## Phase 0 Tasks

| Task | 作用 | 状态线索 |
| --- | --- | --- |
| 1 | pnpm workspace + `@knowledge-base/contracts` | 已存在 |
| 2 | 证明 Mac / iPhone 可跑同一 React 入口 | 见 `validation/phase-0/platform-smoke.md` |
| 3 | 证明 Share Extension → App Group 往返 | 见 `validation/phase-0/app-group-roundtrip.md` |
| 4 | 证明中文语义检索（pgvector） | 见 `validation/phase-0/search-evaluation.json`（Recall@5 = 1.0） |
| 5 | 汇总证据，写出 `GO` / `NO-GO` | **GO**：平台、分享、云端隔离与语义检索门禁均通过 |

## 环境要求

### 通用

- Node.js（建议与宿主一致；验证记录用过 23.x）
- pnpm `11.9.0`（见根 `packageManager`）
- Rust（`rustup` stable，含 Apple 目标）

### Mac / iOS 客户端

- Xcode（验证记录：26.6）与 iOS Simulator
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)（`brew install xcodegen`）：修改 `project.yml` 后需重生 Xcode 工程
- Apple 开发者账号（自动签名即可）；宿主与 Share 必须同一 Team，并启用同一 App Group

### Task 4（语义检索）

- Supabase CLI（`brew install supabase/tap/supabase`）
- 专用 Supabase 云端开发项目（禁止连接生产项目）；根目录 `.env.local` 需含 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` 仅供可信 Node/CLI 验证脚本使用，禁止进入前端代码或安装包
- 模型缓存：`validation/phase-0/model-cache/`（已 gitignore；默认经 `hf-mirror.com`）
- 评估：`pnpm --filter @knowledge-base/search-spike evaluate`

云端数据库验证：

```bash
supabase migration list
pnpm --filter @knowledge-base/search-spike exec vitest run src/cloud-isolation.test.ts
pnpm --filter @knowledge-base/search-spike evaluate
```

`cloud-isolation.test.ts` 直接连接专用 Supabase 云端开发项目，在 `finally` 清理保护下验证 workspace 隔离，不需要本地 Docker。`supabase test db --linked supabase/tests/search_spike_test.sql` 保留为可选 pgTAP 检查；Supabase CLI 的该测试执行器仍依赖本地 Docker daemon，不属于云端-only 开发的必过门禁。

## 快速开始

```bash
# 安装依赖
pnpm install

# 全仓测试与类型检查
pnpm test
pnpm typecheck
```

### Mac 客户端

```bash
cd apps/client
pnpm tauri dev
# 或构建 .app（默认 bundle.targets = app）
pnpm tauri build --debug
```

### iOS 客户端

```bash
cd apps/client
# 确保目标模拟器已 boot，例如 iPhone 17 Pro
pnpm tauri ios dev 'iPhone 17 Pro'
```

也可直接打开：

`apps/client/src-tauri/gen/apple/knowledge-base.xcodeproj`

注意：Xcode 的 `Build Rust Code` 脚本依赖 `pnpm` / `node`。工程已把 Homebrew 路径前置到脚本 `PATH`；若仍报 `node: command not found`，检查本机 Node 安装位置。

### Share Extension

稳定源码在 `apps/client/native/ios-share/`，由 `project.yml` 引用进 `KnowledgeBaseShare` target。

```bash
cd apps/client/src-tauri/gen/apple

# 若改过 project.yml
xcodegen generate

# 单元测试（JSON 往返等，不依赖真实 App Group 写入）
xcodebuild test \
  -project knowledge-base.xcodeproj \
  -scheme KnowledgeBaseShareTests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -configuration debug

# 构建含 Share appex 的宿主
xcodebuild build \
  -project knowledge-base.xcodeproj \
  -scheme knowledge-base_iOS \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -configuration debug
```

手动往返烟测步骤与结果记录见 `validation/phase-0/app-group-roundtrip.md`。

## 验证证据

| 文件 | 内容 |
| --- | --- |
| `validation/phase-0/platform-smoke.md` | Mac / iPhone 平台烟测 |
| `validation/phase-0/app-group-roundtrip.md` | Share + App Group 往返 |
| `validation/phase-0/search-evaluation.json` | 语义检索评估（Task 4） |
| `validation/phase-0/decision.md` | Phase 0 门禁裁决（Task 5） |

只有观察到的证据才能写入裁决；不允许从“代码看起来正确”推断 `GO`。

## 约束

- 仅使用计划中的合成夹具，不用生产或敏感文件
- 检索 spike 只返回匹配文件与来源片段，不生成 AI 回答
- embedding 使用 `vector(384)`，与 `Xenova/multilingual-e5-small` 一致；passage / query 前缀分别为 `passage: ` / `query: `
- 未获明确授权时不要擅自初始化 Git 策略外的提交；依赖下载、模型下载、云端数据库访问、签名变更需执行时确认
