# Phase 3 上传资料入口设计

本阶段在已登录且已选择团队后增加最小可用的资料上传入口。用户可以选择一个 PDF 或 DOCX 文件，客户端先做文件类型、大小和团队状态校验，再调用 Phase 1 已定义的上传 RPC 与 Supabase Storage signed upload 链路。

## 范围

- 支持单文件上传。
- 支持 MIME 为 `application/pdf` 的 PDF。
- 支持 MIME 为 `application/vnd.openxmlformats-officedocument.wordprocessingml.document` 的 DOCX。
- 最大文件大小沿用服务端边界：`100000000` bytes。
- 文件校验失败时不调用云端。
- 未选择团队时不展示可用上传动作。
- `prepare_file_upload` 返回 `duplicate` 时不上传对象，只提示该文件已存在。

## 非范围

- 不做批量上传。
- 不做文件夹拖拽。
- 不做文件预览。
- 不做搜索结果页。
- 不做后台同步、重试队列或 iOS 分享扩展消费。
- 不做成员管理。

## 数据流

1. 用户在当前团队内容区点击文件选择。
2. 客户端校验文件类型、大小和非空文件。
3. 客户端使用 Web Crypto 计算 SHA-256，格式化为 `sha256:<64 lowercase hex>`。
4. 调用 `prepare_file_upload`，参数为：
   - `p_workspace_id`
   - `p_display_name`
   - `p_mime_type`
   - `p_size_bytes`
   - `p_checksum`
5. 如果返回 `duplicate`，界面提示“文件已存在”，不上传。
6. 如果返回 `created`，使用 `documents` bucket 创建 signed upload URL。
7. 使用 signed token 上传原始文件。
8. 调用 `mark_upload_complete`，让服务端进入 `pending_processing`。
9. 界面显示本次上传完成，后续文件列表和处理状态由后续子任务接入。

## 组件与边界

`apps/client/src/uploads/uploadService.ts`

- 负责文件校验、checksum、RPC、Storage 上传和完成标记。
- 暴露 `UploadService.uploadFile(input)`。

`apps/client/src/uploads/useUploadQueue.ts`

- 负责当前界面的轻量上传状态。
- 状态只保存在组件内存，不做持久化。

`apps/client/src/components/UploadPanel.tsx`

- 负责展示上传入口、校验错误、上传中状态、成功和重复提示。
- 不直接依赖 Supabase。

`apps/client/src/components/MainShell.tsx`

- 只在已有当前团队时渲染 `UploadPanel`。
- 未选择团队时保留空状态。

## 错误处理

- 客户端校验错误显示中文固定文案。
- Supabase RPC、Storage 和完成标记错误转成安全错误信息显示。
- 上传中禁用文件输入，避免同一入口重复提交。

## 测试

- 单元测试覆盖文件类型、大小和 checksum 格式。
- App 级测试覆盖：
  - 未选择团队不展示上传按钮。
  - 已选择团队可以上传 PDF。
  - 上传重复文件时展示重复提示。
  - 非 PDF/DOCX 文件不调用上传服务。

