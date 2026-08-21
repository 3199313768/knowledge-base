import {
  formatFileSize,
  formatFileStatus,
  summarizeFileStatuses,
  type FileVersionStatus,
  type FileSummary
} from '../files/fileService';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface FileListPanelProps {
  error: string | null;
  files: FileSummary[];
  isLoading: boolean;
  lastRefreshedAt: string | null;
  onRefresh: () => Promise<void>;
  onSelectFile: (fileId: string) => void;
  selectedFileId: string | null;
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

function statusClassName(status: FileVersionStatus | null | undefined) {
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

export function FileListPanel({
  error,
  files,
  isLoading,
  lastRefreshedAt,
  onRefresh,
  onSelectFile,
  selectedFileId
}: FileListPanelProps) {
  const summary = summarizeFileStatuses(files);
  const refreshedLabel = lastRefreshedAt
    ? formatUpdatedAt(lastRefreshedAt)
    : '尚未刷新';

  return (
    <Card className="file-list-panel" aria-label="团队资料">
      <div className="file-list-panel__header">
        <p className="file-summary" aria-label="文件状态摘要">
          {summary.total === 0
            ? `暂无文件 · 最后刷新：${refreshedLabel}`
            : `共 ${summary.total} 个 · 待处理 ${summary.processing} · 可搜索 ${summary.searchable} · 失败 ${summary.failed} · 最后刷新：${refreshedLabel}`}
        </p>
        <Button disabled={isLoading} onClick={() => void onRefresh()} variant="ghost">
          刷新
        </Button>
      </div>

      {isLoading ? <p className="message">正在读取文件…</p> : null}
      {error ? <p className="message message--error">{error}</p> : null}

      {files.length > 0 ? (
        <div className="file-list" aria-label="团队资料列表">
          {files.map((file) => (
            <article
              className={file.id === selectedFileId ? 'file-row file-row--active' : 'file-row'}
              key={file.id}
            >
              <div className="file-row__main">
                <button
                  aria-label={`查看 ${file.displayName}`}
                  className="file-row__select"
                  onClick={() => onSelectFile(file.id)}
                  type="button"
                >
                  {file.displayName}
                </button>
                <p>{formatUpdatedAt(file.updatedAt)}</p>
              </div>
              <div className="file-row__meta">
                <Badge tone={statusClassName(file.currentVersion?.status)}>
                  {formatFileStatus(file.currentVersion?.status ?? null)}
                </Badge>
                <span>{formatFileSize(file.currentVersion?.sizeBytes ?? null)}</span>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
