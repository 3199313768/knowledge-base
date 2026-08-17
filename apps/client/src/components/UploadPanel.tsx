import { useId } from 'react';
import { useUploadQueue } from '../uploads/useUploadQueue';
import { Card } from './ui/Card';
import type { UploadService } from '../uploads/uploadService';

interface UploadPanelProps {
  onUploadSettled?: () => void;
  uploadService: UploadService;
  workspaceId: string;
}

export function UploadPanel({
  onUploadSettled,
  uploadService,
  workspaceId
}: UploadPanelProps) {
  const inputId = useId();
  const uploadState = useUploadQueue(uploadService, workspaceId);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    const result = await uploadState.uploadFile(file);
    if (result) {
      onUploadSettled?.();
    }
  }

  return (
    <Card className="upload-panel" aria-labelledby="upload-title">
      <div className="upload-panel__copy">
        <p className="eyebrow">Upload</p>
        <h2 id="upload-title">上传资料</h2>
        <p>选择一个 PDF 或 DOCX，文件会归属到当前团队。</p>
      </div>

      <label className="upload-target" htmlFor={inputId}>
        <span className="upload-target__icon" aria-hidden="true">
          ↑
        </span>
        <span className="upload-target__title">选择 PDF 或 DOCX</span>
        <span className="upload-target__hint">最大 100MB，当前仅支持单文件</span>
      </label>
      <input
        accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="选择 PDF 或 DOCX"
        className="upload-input"
        disabled={uploadState.isUploading}
        id={inputId}
        onChange={handleFileChange}
        type="file"
      />

      {uploadState.isUploading ? <p className="message">正在上传…</p> : null}
      {uploadState.error ? (
        <p className="message message--error">{uploadState.error}</p>
      ) : null}
      {uploadState.lastResult?.outcome === 'uploaded' && uploadState.lastFileName ? (
        <p className="message message--notice">上传完成：{uploadState.lastFileName}</p>
      ) : null}
      {uploadState.lastResult?.outcome === 'duplicate' && uploadState.lastFileName ? (
        <p className="message message--notice">文件已存在：{uploadState.lastFileName}</p>
      ) : null}
    </Card>
  );
}
