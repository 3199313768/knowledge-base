# Phase 0 平台烟测

> 本次续验日期：2026-08-05。除本次命令输出外，保留 2026-08-04 控制器通过 Computer Use 获得的 Mac 可见烟测证据；两次环境结果会明确区分。

## 环境

`pnpm --dir apps/client tauri info` 显示：

- OS：macOS 26.5.2 arm64
- Xcode Command Line Tools：installed；Xcode：26.6
- rustc：1.97.1；cargo：1.97.1；rustup：1.29.0
- Rust toolchain：stable-aarch64-apple-darwin（default）
- Node：23.11.0；pnpm：10.14.0（Codex shell）；宿主验证与根 `packageManager` 使用 pnpm 11.9.0
- `@tauri-apps/api`：2.11.1；`@tauri-apps/cli`：2.11.4

## Mac

| 项 | 命令/证据 | 结果 |
| --- | --- | --- |
| 原生应用构建 | `pnpm --dir apps/client tauri build --debug --bundles app` | 退出码 0；生成 `apps/client/src-tauri/target/debug/bundle/macos/KnowledgeBase.app`。**通过**。 |
| 历史默认打包 | 原先 `pnpm --dir apps/client tauri build --debug` | 退出码 1；当时默认目标含 DMG，`hdiutil create` 返回“设备未配置”。这是历史环境证据。 |
| 当前默认打包 | `pnpm --dir apps/client tauri build --debug` | **退出码 0**；`bundle.targets` 已限定为 `app`，生成 `KnowledgeBase.app`，不再尝试 DMG。 |
| Mac 最低版本 | `bundle.macOS.minimumSystemVersion: "14.0"`；生成的 `KnowledgeBase.app/Contents/Info.plist` | **通过**：`LSMinimumSystemVersion = 14.0`。 |
| 控制器独立复核 | pnpm 11.9.0 执行原始 `tauri build --debug`，并检查生成 bundle | **通过**：退出码 0；`KnowledgeBase.app` 的 Bundle ID 为 `com.local.knowledgebase`、产品名为 `KnowledgeBase`、`LSMinimumSystemVersion = 14.0`。 |
| 开发模式 | `pnpm --dir apps/client tauri dev` | 退出码 1；Vite 监听 `::1:1420` 返回 `listen EPERM: operation not permitted`。仅改为 `127.0.0.1:1420` 后仍为同一错误，确认不是 IPv6 或项目配置。 |
| 既有可见烟测 | 2026-08-04：控制器通过 Computer Use 启动构建的 `KnowledgeBase.app`；AX 树显示窗口标题 `Knowledge Base`、页面标题“Knowledge Base 技术验证”及正文“Mac 与 iPhone 共用同一个 React 入口。” | **通过**。这是已取得的真实 Mac 可见证据。 |
| 本轮窗口复验 | 本轮 `tauri dev` 被端口 `EPERM` 阻断；直接启动本轮构建的 `.app` 被 LaunchServices 以 `kLSNoExecutableErr` 拒绝，尽管 bundle 内的可执行文件存在。 | 未能在本轮重复显示窗口；不否定 2026-08-04 的可见烟测通过。 |

## iPhone

| 项 | 命令/证据 | 结果 |
| --- | --- | --- |
| iOS 初始化生成物与身份 | 实际路径为 `apps/client/src-tauri/gen/apple/knowledge-base.xcodeproj`；产品名 `KnowledgeBase`、Bundle ID `com.local.knowledgebase`、native target `knowledge-base_iOS`、shared scheme `KnowledgeBase_iOS` | **静态核对通过**：路径与产品/target/scheme 身份已明确区分，scheme 的 `ReferencedContainer` 也已同步小写实际路径。本轮为保留 PATH 修复，未重跑可能覆盖既有工程的 `tauri ios init`。 |
| iOS 最低版本 | `tauri.conf.json` 的 `bundle.iOS.minimumSystemVersion: "17.0"`、`project.yml` 与 `.pbxproj` 的两处 `IPHONEOS_DEPLOYMENT_TARGET` | **通过**：三处均为 iOS 17.0。 |
| 宿主 Runtime 与设备 | Xcode Components 已显示 iOS 26.5.1 与 iOS 26.5 Simulator 8.49 GB 已安装；Xcode `Window > Devices and Simulators` 中实际可见 iOS 26.5 (23F77) 设备集 | **通过（宿主可用性）**。这否定了“Runtime 缺失”的旧结论。 |
| 目标设备 | Devices 窗口选中 `iPhone 17 Pro`，详情为 `iOS 26.5 (23F77)`，Identifier `72B0C6A2-635C-4262-99B5-8184AF1F70E2` | **通过（目标存在）**。 |
| Codex shell 的 `simctl` | `xcrun simctl list devices available` 退出码 1，报 `CoreSimulatorService connection refused` | **受限环境现象**：Codex shell 无法访问 CoreSimulator 的服务/日志上下文；不能据此推断宿主 Runtime 或设备不存在。 |
| Xcode 首次 Debug（RED） | `KnowledgeBase_iOS` / `iPhone 17 Pro` 的 Build Log 在 `Build Rust Code` 失败：`node: command not found` | **已定位**：生成脚本依赖的 `node` 不在 Xcode 的 PATH。 |
| 最小修复 | `project.yml` 与 `project.pbxproj` 都改为 `PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}" pnpm tauri ios xcode-script ...` | **已落盘**。再次 Debug 已执行到 `pnpm tauri ios xcode-script`，证明 PATH/命令入口修复生效。 |
| 外层启动与首次 RED | 宿主 Terminal 执行 `pnpm --dir apps/client tauri ios dev 'iPhone 17 Pro'` 后，先遇到 Simulator `Shutdown`（code 405，exit 149） | **已处理**：显式 boot 目标 Simulator 后重试成功；这也证明此前直接 Xcode Run 缺少 server-addr 文件并非工程无法启动。 |
| iPhone 可见烟测 | 控制器通过 Computer Use 独立观察 Simulator 窗口 `iPhone 17 Pro`（iOS 26.5），页面显示标题“Knowledge Base 技术验证”和正文“Mac 与 iPhone 共用同一个 React 入口。” | **通过**。型号、系统版本与页面内容均为真实可见证据。 |

## 后续关注项

1. 依赖策略保持最小化：只排除 `node-releases@2.0.52` 的 release-age 检查，只允许 `esbuild` 构建；宿主已通过 269 条 supply-chain age 校验。
2. 默认构建现已只生成 `.app`，符合 Phase 0 范围；DMG 不属于本阶段交付物。Codex shell 的 `tauri dev` 端口 `EPERM` 仍是沙箱边界；如需宿主 Mac 复验开发模式，执行 `cd /Users/yangqian/Documents/Codex/2026-08-04/w/.worktrees/phase-0 && pnpm --dir apps/client tauri dev`。
3. 2026-08-05 task-scoped re-review 已完成：`@knowledge-base/contracts` 2/2 测试、client 1/1 测试、三个 workspace 类型检查均退出 0；`pnpm --dir apps/client tauri build --debug` 退出 0 并生成 `KnowledgeBase.app`。结合上文已经独立观察的 Mac/iPhone 可见烟测，Task 2 验收完成。
