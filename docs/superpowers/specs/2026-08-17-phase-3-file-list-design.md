# Phase 3 当前团队文件列表设计

本阶段在上传入口之后增加当前团队文件列表壳。目标是让用户完成上传后能看到资料记录进入系统，并能识别当前版本处理状态。

## 范围

- 只展示当前团队下未删除文件。
- 展示文件名、当前版本状态、大小和更新时间。
- 上传成功或重复文件提示后刷新列表。
- 支持手动刷新。
- 支持加载、空列表和错误状态。

## 非范围

- 不做文件预览。
- 不做下载 signed URL。
- 不做软删除。
- 不做处理失败重试。
- 不做实时订阅或轮询。
- 不做搜索。

## 数据流

1. 用户选择当前团队。
2. 客户端查询 `files`，筛选 `workspace_id` 和 `deleted_at is null`。
3. 查询字段包含当前版本关系：`current_version:file_versions!files_current_version_fk(id,status,size_bytes,mime_type,created_at)`。
4. 文件列表按 `updated_at desc` 排序。
5. 上传面板完成一次上传后调用 `onUploadSettled()`。
6. 主界面触发文件列表刷新。

## 组件与边界

`apps/client/src/files/fileService.ts`

- 负责 Supabase 文件列表查询。
- 暴露 `FileService.listFiles(workspaceId)`。

`apps/client/src/files/useFiles.ts`

- 负责当前团队文件列表状态。
- 暴露 `refreshFiles()` 给上传入口回调使用。

`apps/client/src/components/FileListPanel.tsx`

- 只负责渲染文件列表、空状态、错误和手动刷新按钮。

`apps/client/src/components/UploadPanel.tsx`

- 新增可选 `onUploadSettled` 回调。
- 上传成功或重复文件后调用；校验失败不刷新。

`apps/client/src/components/MainShell.tsx`

- 持有当前团队文件列表状态。
- 将 `refreshFiles` 传给上传入口。
- 在上传入口下方展示文件列表。

## 状态文案

- `awaiting_upload`：等待上传
- `pending_processing`：等待处理
- `processing`：处理中
- `searchable`：可搜索
- `partially_searchable`：部分可搜索
- `failed`：处理失败

未知状态显示为“未知状态”。

## 测试

- 文件服务测试覆盖行数据映射、状态文案、大小格式。
- App 级测试覆盖当前团队有文件时展示列表、空状态、读取失败、上传成功后刷新列表。

