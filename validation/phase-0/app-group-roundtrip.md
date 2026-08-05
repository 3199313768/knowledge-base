# Phase 0 iOS 分享扩展烟测

## 环境

- 日期：2026-08-05
- 模拟器：iPhone 17 Pro，iOS 26.5
- 宿主 Bundle ID：`com.local.knowledgebase`
- 分享扩展 Bundle ID：`com.local.knowledgebase.share`
- App Group：`group.com.local.knowledgebase`

## 自动化验证

1. `xcodebuild test -project knowledge-base.xcodeproj -scheme KnowledgeBaseShareTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -configuration debug`
   - 结果：2 个测试通过，0 个失败。
   - 覆盖：分享载荷 JSON 往返、PDF 类型优先选择。
2. `xcodebuild build -project knowledge-base.xcodeproj -scheme knowledge-base_iOS -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -configuration debug`
   - 结果：`BUILD SUCCEEDED`。
   - 产物包含 `KnowledgeBase.app/PlugIns/KnowledgeBaseShare.appex`。
3. `pnpm test && pnpm typecheck`
   - 结果：前端与 contracts 共 3 个测试通过，TypeScript 类型检查通过。

## PDF 分享往返

1. 在模拟器 Safari 打开本地测试文件 `NotAllowed.pdf`（12,212 字节）。
2. 进入系统分享面板，选择 `KnowledgeBase`，点击“发布”。
3. 扩展完成后正常返回 Safari。
4. 使用 `xcrun simctl get_app_container booted com.local.knowledgebase groups` 定位共享容器并检查结果。

实际写入：

- `Inbox/F0916C78-789A-4055-9158-4A7AC4F32E80-NotAllowed.pdf`，12,212 字节。
- `Queue/F0916C78-789A-4055-9158-4A7AC4F32E80.json`，196 字节。
- 队列字段：`kind=file`、`displayName=NotAllowed.pdf`，`storedFileName` 与 Inbox 文件名一致。

## 结论

iOS 分享扩展能够接收 PDF，将原文件复制到 App Group 的 `Inbox`，并在 `Queue` 写入对应 JSON 元数据。Task 3 的 App Group 分享往返通过。
