# Phase 2 本地决策

- 决策日期：2026-08-17（Asia/Shanghai）
- 当前提交：`79f70f98a57c713bb2c7e9ca9db6773eecaf5dca`
- 工作区：存在当前实现的已修改与未跟踪文件；未执行 `git add`、commit、push 或 PR。
- 证据边界：只记录本地单元测试、缓存模型测试、TypeScript 检查和静态文件检查；没有连接 Supabase，也没有运行 pgTAP、迁移、真实 worker 或云端授权测试。

## 本地门禁

命令：

```bash
pnpm verify:phase-2-local
```

结果：退出码 `0`。

| 层 | 结果 |
|---|---|
| workspace 单元测试 | 25 个测试文件，161 个测试通过 |
| processing-worker | 13 个测试文件，115 个测试通过 |
| search-core 离线模型 | 1 个测试文件，1 个测试通过；使用已有 `multilingual-e5-small` 缓存，未下载远程模型 |
| TypeScript | 6 个 workspace 项目类型检查通过 |
| `git diff --check` | 通过，无空白错误 |

## 固定处理夹具

夹具来自 `fixtures/processing/manifest.json`，生成器会校验 macOS 原生字体 SHA-256 并比较每个文件的字节数与 SHA-256。当前 manifest 中固定记录如下：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| native-text.pdf | 22619 | `81113e9b943f943e82ac35b2f9a8b463dad397311028c21f1c1f91423601e235` |
| empty.pdf | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991bb7852b855` |
| encrypted.pdf | 1761 | `88b81b58edd1e2919fbf888622c70d83d8b701f03b13b55fd34e498827baf0b1` |
| corrupt.pdf | 17 | `01fe40ee6cb264b8c4c350af2aa5599a81bc9068213a9d81a2a0152b9119c68d` |
| paragraphs-and-table.docx | 1064 | `7650c80fc6b32beba072db765e81000e8cd0064b6491808a0ab35a8a87f4d140` |
| empty.docx | 930 | `e4316e91d58c418e1dce0eabb3399e798925bdf9821923c7ef5b5b4ebcf6d42c` |
| corrupt.docx | 19 | `3b6908c15ecb3d572c9011d39358a26dd11f65f2c7c71d4c68ac50bd181a666f` |
| oversized-entry.docx | 1064 | `6ad21f7716f07038e01523e7134a6875e0582a6ca2b0dc293aa93f341de8dcd4` |
| pdf-named-as-docx.docx | 1529 | `d2d1d71f51bd1e546b71a4acca5004eaa29e9264f6e5f238044370345e91d291` |

## 当前支持范围

- 支持：原生文本 PDF、原生文本 DOCX；包含页码/段落/表格来源位置、确定性分块、384 维离线 E5 embedding、混合搜索本地排序核心。
- 不支持：扫描件 OCR、网页、PPTX、XLSX、JPG/JPEG、PNG、HEIC、客户端 UI、真实 worker 部署、AI 问答和摘要。

## 尚未运行的证据层

| 项 | 状态 | 说明 |
|---|---|---|
| Phase 2 processing migration | **UNRUN** | 仅完成 SQL 源码，未连接数据库 |
| Phase 2 hybrid-search migration | **UNRUN** | 仅完成 SQL 源码，未验证 PostgreSQL 行为 |
| processing / hybrid pgTAP | **UNRUN** | 需要单独授权的一次性数据库 |
| RLS、普通 JWT workspace 隔离 | **UNRUN** | 本地测试不能代替授权测试 |
| Storage artifact 权限与清理 | **UNRUN** | 未运行云端 Storage |
| 云端 lease、原子发布与迁移重放 | **UNRUN** | 未执行 migration replay 或真实 worker |
| 30～50 个真实问题 Recall@5 | **UNRUN** | 当前只有本地合成契约测试 |
| 5,000 文件性能 | **UNRUN** | 未做规模测试 |

## 决策

**子项目决策：LOCALLY VERIFIED。** 本地门禁完整通过，处理夹具、worker 单测、混合搜索核心、离线模型和类型检查均有当前工作树证据。

**Phase 2 总体：未完成。发布状态：仍阻断。** 本地结果不代表 Supabase 迁移、RLS/Storage、云端 worker、真实问题集质量或性能门禁通过。

**Phase 1：保持 `NOT EVALUATED / NO-GO FOR RELEASE`。** 本次 Phase 2 是用户确认的顺序例外，不改变 Phase 1 的运行证据要求。
