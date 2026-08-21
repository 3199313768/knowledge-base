import {
  formatFileSize,
  formatFileStatus,
  type FileSummary,
  type FileVersionStatus
} from '../files/fileService';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

interface FileInspectorProps {
  file: FileSummary | null;
  onDeleteFile: (file: FileSummary) => Promise<void>;
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
  onRetryFile
}: FileInspectorProps) {
  if (!file) {
    return null;
  }

  const status = file.currentVersion?.status ?? null;

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

      <div className="file-inspector__actions">
        {status === 'failed' ? (
          <Button
            aria-label="重新处理选中文件"
            onClick={() => void onRetryFile(file)}
            variant="ghost"
          >
            重新处理
          </Button>
        ) : null}
        <Button aria-label="删除选中文件" onClick={() => void onDeleteFile(file)} variant="ghost">
          删除
        </Button>
      </div>
    </aside>
  );
}
