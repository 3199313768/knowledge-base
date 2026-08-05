# Phase 0 Decision

## Platform build

既有可见烟测（2026-08-04）：控制器通过 Computer Use 启动构建的 `KnowledgeBase.app`；AX 树显示窗口标题 `Knowledge Base`、页面标题“Knowledge Base 技术验证”及正文“Mac 与 iPhone 共用同一个 React 入口。” **通过**。

iPhone 可见烟测：控制器通过 Computer Use 独立观察 Simulator 窗口 `iPhone 17 Pro`（iOS 26.5），页面显示标题“Knowledge Base 技术验证”和正文“Mac 与 iPhone 共用同一个 React 入口。” **通过**。

2026-08-05 本轮本地自动化复核：`@knowledge-base/contracts` 2/2 测试、client 1/1 测试和三个 workspace 的 `pnpm typecheck` 均退出码 0；`pnpm --dir apps/client tauri build --debug` 退出码 0 并生成 `KnowledgeBase.app`。搜索 spike 的测试需要访问 linked 云端开发项目，本轮未将其包含在本地测试通过数中。

## Share Extension

实际写入：

- `Inbox/F0916C78-789A-4055-9158-4A7AC4F32E80-NotAllowed.pdf`，12,212 字节。
- `Queue/F0916C78-789A-4055-9158-4A7AC4F32E80.json`，196 字节。
- 队列字段：`kind=file`、`displayName=NotAllowed.pdf`，`storedFileName` 与 Inbox 文件名一致。

使用 `xcrun simctl get_app_container booted com.local.knowledgebase groups` 定位共享容器并检查结果，确认宿主 Bundle 可见 App Group 中的文件与队列元数据。

结论原文：iOS 分享扩展能够接收 PDF，将原文件复制到 App Group 的 `Inbox`，并在 `Queue` 写入对应 JSON 元数据。Task 3 的 App Group 分享往返通过。

## Semantic retrieval

最近一次已记录的 `pnpm --filter @knowledge-base/search-spike evaluate` 结果：

```json
{
  "queryCount": 10,
  "hits": 10,
  "recallAt5": 1
}
```

模型：`Xenova/multilingual-e5-small`，维度 384；远程项目 `lzlckiyblyhlgabztwax` 已应用 `spike_chunks` / `match_spike_chunks`。

历史 workspace 隔离观察（与 `supabase/tests/search_spike_test.sql` 等价断言，经 `supabase db query --linked` 观察）：

- `workspace_a_count = 1`
- `workspace_a_file = 团队 A 报价.pdf`

本轮计划执行 `supabase migration list`、`supabase test db --linked supabase/tests/search_spike_test.sql` 和 fresh 语义评估，但 Codex 权限审批服务连续返回 503，命令没有启动，也没有访问或修改云端数据库。因此 linked 迁移历史、pgTAP 和 fresh Recall@5 尚无本轮证据。

## Next action

**Decision:** NO-GO

待权限审批服务恢复后，重新执行 linked 迁移历史检查、pgTAP、语义评估和全仓测试；只有全部退出码为 0 才改为 `GO` 并编写 Phase 1 云端基础实施计划。
