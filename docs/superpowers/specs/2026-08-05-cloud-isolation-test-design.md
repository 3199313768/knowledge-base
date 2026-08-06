# 云端 Workspace 隔离测试设计

## 目标

在不启动本地 Docker 的前提下，直接对专用 Supabase 云端开发项目验证 `match_spike_chunks` 不会返回其他 workspace 的数据，并让该验证进入 `pnpm test` 门禁。

## 根因与边界

`supabase test db --linked` 能连接远程数据库，但本机 CLI 仍使用需要 Docker 的测试执行器，因此它不符合纯云端开发约束。新的测试只验证 Phase 0 搜索函数的 `workspace_id` 过滤行为；它使用 service-role 凭据，不验证 RLS。RLS、anon/authenticated 角色和跨团队授权属于 Phase 1。

## 架构

- `apps/search-spike/src/cloudIsolation.ts` 提供 `runCloudIsolationCheck()`，负责建立可信云端客户端、生成本次运行专用 UUID、写入两个 workspace 的合成行、调用真实 RPC，并在 `finally` 中删除合成行。
- `apps/search-spike/src/cloud-isolation.test.ts` 调用真实云端开发项目，不使用 mock；断言 workspace A 只返回自己的文件，且不泄漏 workspace B 文件。
- 现有 `supabase/tests/search_spike_test.sql` 保留为可选 pgTAP 资产，但不再作为无 Docker 的 Phase 0 必跑门禁。

## 数据流

1. 从 `.env.local` 读取 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`，密钥不写入日志或测试报告。
2. 使用 `crypto.randomUUID()` 为两条 chunk、两个 workspace 和两个 file 生成唯一 ID。
3. 两个 chunk 使用相同的 384 维确定性向量，避免相似度差异掩盖 workspace 过滤错误。
4. 调用 `match_spike_chunks` 查询 workspace A，限制返回 10 条。
5. 返回文件名列表给 Vitest；无论插入、RPC 或断言是否失败，`finally` 都按本次 chunk ID 删除测试行。

## 错误处理

- 缺失环境变量、插入失败、RPC 失败或清理失败都直接让测试失败。
- 清理只匹配本次生成的 chunk ID，不删除共享开发库中的其他数据。
- 测试不打印 URL、service-role key 或数据库连接串。

## 验收

- 新测试在 helper 尚不存在时以模块缺失进入 RED。
- 实现 helper 后，云端隔离测试通过并确认只返回 workspace A 文件。
- `pnpm test`、`pnpm typecheck`、语义评估和 Mac debug build 全部退出 0。
- `decision.md` 仅在上述新鲜证据齐全后改为 `GO`。

