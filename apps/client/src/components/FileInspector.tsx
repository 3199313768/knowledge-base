import { StatusMessage } from '@oxygen-design/ui';
import { useEffect, useRef, useState } from 'react';
import {
  formatFileSize,
  formatFileStatus,
  toFileOperationError,
  type FileSummary,
  type FileVersionStatus
} from '../files/fileService';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

interface FileInspectorProps {
  file: FileSummary | null;
  onDeleteFile: (file: FileSummary) => Promise<void>;
  onPreviewFile: (file: FileSummary) => Promise<string>;
  onRetryFile: (file: FileSummary) => Promise<void>;
}

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return '更新时间未知';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function statusTone(status: FileVersionStatus | null | undefined) {
  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'searchable' || status === 'partially_searchable') {
    return 'ready';
  }

  if (
    status === 'awaiting_upload' ||
    status === 'pending_processing' ||
    status === 'processing'
  ) {
    return 'processing';
  }

  return 'default';
}

export function FileInspector({
  file,
  onDeleteFile,
  onPreviewFile,
  onRetryFile
}: FileInspectorProps) {
  const previewRequestRef = useRef(0);
  const retryRequestRef = useRef(0);
  const retryFileKeyRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryOutcome, setRetryOutcome] = useState<string | null>(null);

  useEffect(() => {
    previewRequestRef.current += 1;
    retryRequestRef.current += 1;
    setPreviewUrl(null);
    setPreviewError(null);
    setIsPreviewing(false);
    setIsRetrying(false);
    setRetryOutcome(null);
  }, [file?.id, file?.currentVersion?.id]);

  if (!file) {
    return null;
  }

  const selectedFile = file;
  const retryFileKey = `${selectedFile.id}:${selectedFile.currentVersion?.id ?? ''}`;
  retryFileKeyRef.current = retryFileKey;

  const status = file.currentVersion?.status ?? null;
  const mimeType = file.currentVersion?.mimeType?.toLowerCase() ?? '';
  const isPdf = mimeType === 'application/pdf' || file.displayName.toLowerCase().endsWith('.pdf');
  const isDocx =
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.displayName.toLowerCase().endsWith('.docx');

  async function handlePreview() {
    const requestToken = ++previewRequestRef.current;
    setIsPreviewing(true);
    setPreviewError(null);
    try {
      const nextUrl = await onPreviewFile(selectedFile);
      if (requestToken === previewRequestRef.current) {
        setPreviewUrl(nextUrl);
      }
    } catch {
      if (requestToken === previewRequestRef.current) {
        setPreviewUrl(null);
        setPreviewError('文件预览暂不可用，请检查文件权限或稍后重试');
      }
    } finally {
      if (requestToken === previewRequestRef.current) {
        setIsPreviewing(false);
      }
    }
  }

  async function handleRetry() {
    if (isRetrying || selectedFile.currentVersion?.canRetry !== true) {
      return;
    }

    const requestToken = ++retryRequestRef.current;
    setIsRetrying(true);
    setRetryOutcome(null);
    try {
      await onRetryFile(selectedFile);
      if (requestToken === retryRequestRef.current && retryFileKeyRef.current === retryFileKey) {
        setRetryOutcome('已提交重新处理');
      }
    } catch (error) {
      if (requestToken === retryRequestRef.current && retryFileKeyRef.current === retryFileKey) {
        setRetryOutcome(toFileOperationError(error).message);
      }
    } finally {
      if (requestToken === retryRequestRef.current && retryFileKeyRef.current === retryFileKey) {
        setIsRetrying(false);
      }
    }
  }

  return (
    <aside className="file-inspector" aria-label="文件检查器">
      <div className="file-inspector__header">
        <h2>{file.displayName}</h2>
        <Badge tone={statusTone(status)}>{formatFileStatus(status)}</Badge>
      </div>

      <dl className="file-inspector__meta" aria-label="选中文件信息">
        <div>
          <dt>文件大小</dt>
          <dd>{formatFileSize(file.currentVersion?.sizeBytes ?? null)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatUpdatedAt(file.updatedAt)}</dd>
        </div>
      </dl>

      {status === 'failed' ? (
        <p className="file-inspector__warning">当前版本处理失败</p>
      ) : null}

      <section className="file-inspector__preview" aria-label="文件预览">
        <h3>文件预览</h3>
        {isPdf ? (
          <>
            <Button
              aria-label="生成 PDF 预览链接"
              disabled={isPreviewing}
              onClick={() => void handlePreview()}
              variant="link"
            >
              {isPreviewing ? '正在生成预览…' : '打开 PDF 预览'}
            </Button>
            {previewUrl ? (
              <a href={previewUrl} rel="noreferrer" target="_blank">
                在新窗口打开 PDF
              </a>
            ) : null}
          </>
        ) : isDocx ? (
          <>
            <p>DOCX 文件暂不支持内嵌预览，请下载后使用文档应用打开。</p>
            <Button
              aria-label="准备 DOCX 下载链接"
              disabled={isPreviewing}
              onClick={() => void handlePreview()}
              variant="link"
            >
              {isPreviewing ? '正在准备下载…' : '准备下载链接'}
            </Button>
            {previewUrl ? (
              <a
                download={file.displayName}
                href={previewUrl}
                rel="noreferrer"
                target="_blank"
              >
                下载并打开 DOCX
              </a>
            ) : null}
          </>
        ) : (
          <p>当前文件类型暂不支持预览。</p>
        )}
        {previewError ? (
          <StatusMessage tone="error">{previewError}</StatusMessage>
        ) : null}
      </section>

      <div className="file-inspector__actions">
        {status === 'failed' && file.currentVersion?.canRetry === true ? (
          <Button
            aria-label="重新处理选中文件"
            aria-busy={isRetrying}
            disabled={isRetrying}
            onClick={() => void handleRetry()}
            variant="ghost"
          >
            {isRetrying ? '正在重新处理…' : '重新处理'}
          </Button>
        ) : null}
        {retryOutcome ? (
          <StatusMessage aria-live="polite">{retryOutcome}</StatusMessage>
        ) : null}
        <Button aria-label="删除选中文件" onClick={() => void onDeleteFile(file)} variant="ghost">
          删除
        </Button>
      </div>
    </aside>
  );
}
