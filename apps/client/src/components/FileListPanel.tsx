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
  onDeleteFile: (file: FileSummary) => Promise<void>;
  onRefresh: () => Promise<void>;
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
  onDeleteFile,
  onRefresh,
  onRetryFile
}: FileListPanelProps) {
  const summary = summarizeFileStatuses(files);

  return (
    <Card className="file-list-panel" aria-labelledby="file-list-title">
      <div className="file-list-panel__header">
        <div>
          <p className="eyebrow">Files</p>
          <h2 id="file-list-title">团队资料</h2>
        </div>
        <Button
          disabled={isLoading}
          onClick={() => void onRefresh()}
          variant="ghost"
        >
          刷新
        </Button>
      </div>

      <div className="file-summary" aria-label="文件状态摘要">
        <span>共 {summary.total} 个文件</span>
        <span>{summary.processing} 个待处理</span>
        <span>{summary.searchable} 个可搜索</span>
        <span>{summary.failed} 个失败</span>
        <span>
          最后刷新：
          {lastRefreshedAt ? formatUpdatedAt(lastRefreshedAt) : '尚未刷新'}
        </span>
      </div>

      {isLoading ? <p className="message">正在读取文件…</p> : null}
      {error ? <p className="message message--error">{error}</p> : null}

      {!isLoading && !error && files.length === 0 ? (
        <div className="file-list-empty">
          <h3>还没有资料</h3>
          <p>上传一个 PDF 或 DOCX 后，会在这里显示处理状态。</p>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="file-list" aria-label="团队资料列表">
          {files.map((file) => (
            <article className="file-row" key={file.id}>
              <div>
                <h3>{file.displayName}</h3>
                <p>{formatUpdatedAt(file.updatedAt)}</p>
              </div>
              <div className="file-row__meta">
                <Badge tone={statusClassName(file.currentVersion?.status)}>
                  {formatFileStatus(file.currentVersion?.status ?? null)}
                </Badge>
                <span>{formatFileSize(file.currentVersion?.sizeBytes ?? null)}</span>
                {file.currentVersion?.status === 'failed' ? (
                  <Button
                    aria-label={`重新处理 ${file.displayName}`}
                    onClick={() => void onRetryFile(file)}
                    variant="ghost"
                  >
                    重新处理
                  </Button>
                ) : null}
                <Button
                  aria-label={`删除 ${file.displayName}`}
                  onClick={() => void onDeleteFile(file)}
                  variant="ghost"
                >
                  删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
