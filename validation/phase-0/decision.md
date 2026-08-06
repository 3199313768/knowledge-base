# Phase 0 Decision

## Platform build

既有可见烟测（2026-08-04）：控制器通过 Computer Use 启动构建的 `KnowledgeBase.app`；AX 树显示窗口标题 `Knowledge Base`、页面标题“Knowledge Base 技术验证”及正文“Mac 与 iPhone 共用同一个 React 入口。” **通过**。

iPhone 可见烟测：控制器通过 Computer Use 独立观察 Simulator 窗口 `iPhone 17 Pro`（iOS 26.5），页面显示标题“Knowledge Base 技术验证”和正文“Mac 与 iPhone 共用同一个 React 入口。” **通过**。

2026-08-05 本轮自动化复核：`pnpm test` 的 client 1/1、contracts 2/2、search-spike 3/3 测试全部通过，共 6/6；三个 workspace 的 `pnpm typecheck` 均退出码 0；`pnpm --dir apps/client tauri build --debug` 退出码 0 并生成 `KnowledgeBase.app`。

## Share Extension

实际写入：

- `Inbox/F0916C78-789A-4055-9158-4A7AC4F32E80-NotAllowed.pdf`，12,212 字节。
- `Queue/F0916C78-789A-4055-9158-4A7AC4F32E80.json`，196 字节。
- 队列字段：`kind=file`、`displayName=NotAllowed.pdf`，`storedFileName` 与 Inbox 文件名一致。

使用 `xcrun simctl get_app_container booted com.local.knowledgebase groups` 定位共享容器并检查结果，确认宿主 Bundle 可见 App Group 中的文件与队列元数据。

结论原文：iOS 分享扩展能够接收 PDF，将原文件复制到 App Group 的 `Inbox`，并在 `Queue` 写入对应 JSON 元数据。Task 3 的 App Group 分享往返通过。

## Semantic retrieval

2026-08-05 本轮 `pnpm --filter @knowledge-base/search-spike evaluate` 结果：

```json
{
  "queryCount": 10,
  "hits": 10,
  "recallAt5": 1
}
```

模型：`Xenova/multilingual-e5-small`，维度 384；10 个查询全部在 Top 5 命中，Recall@5 = 1.0。

`supabase migration list` 成功连接专用云端开发项目；本地与远程迁移历史一致：

- Local：`20260804000100`
- Remote：`20260804000100`

真实云端 workspace 隔离门禁：

- `pnpm --filter @knowledge-base/search-spike exec vitest run src/cloud-isolation.test.ts`：1/1 通过。
- 测试使用两个随机 workspace 和两条同向量合成记录调用 `match_spike_chunks`，workspace A 的查询只返回 A 文件，不返回 B 文件，并在 `finally` 中清理合成数据。
- 该测试也包含在上述全仓 `pnpm test` 的 search-spike 3/3 通过结果中。

`supabase test db --linked supabase/tests/search_spike_test.sql` 已成功连接远程数据库，但 Supabase CLI 随后要求本地 Docker daemon 来启动 pgTAP 执行器，因此在 cloud-only 开发模式下未运行。SQL pgTAP 文件继续保留为可选检查；必过隔离门禁由不依赖 Docker、直接访问专用云端项目的 Vitest 集成测试承担。

## Next action

**Decision:** GO

编写 Phase 1 云端基础实施计划，继续使用专用 Supabase 云端开发项目，并将真实云端 Vitest 集成测试作为数据库隔离门禁；本地 Docker 栈和 linked pgTAP 不作为前端开发前置条件。
