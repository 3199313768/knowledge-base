import { useState } from 'react';
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
import {
  FileStatusCenter,
  filterFilesByStatus,
  type FileStatusFilter
} from './FileStatusCenter';
import { useBatchFileOperations } from '../files/useBatchFileOperations';
import { BatchOperationSummary } from './BatchOperationSummary';
import type { FileService } from '../files/fileService';

interface FileListPanelProps {
  error: string | null;
  files: FileSummary[];
  isLoading: boolean;
  lastRefreshedAt: string | null;
  onRefresh: () => Promise<void>;
  onRetryFile: (file: FileSummary) => Promise<void>;
  onSelectFile: (fileId: string) => void;
  selectedFileId: string | null;
  fileService?: FileService;
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
  onRetryFile,
  onSelectFile,
  selectedFileId
  ,fileService
}: FileListPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const batch = useBatchFileOperations(fileService ?? ({
    getFilePreviewUrl: async () => '',
    listFiles: async () => [],
    retryFileVersion: async () => undefined,
    softDeleteFile: async () => undefined
  } as FileService));
  const [filter, setFilter] = useState<FileStatusFilter>('all');
  const summary = summarizeFileStatuses(files);
  const visibleFiles = filterFilesByStatus(files, filter);
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

      <FileStatusCenter
        error={error}
        files={files}
        filter={filter}
        isLoading={isLoading}
        onFilterChange={setFilter}
        onRetryFailed={onRetryFile}
        summary={summary}
      />
      {fileService && visibleFiles.length ? <div className="batch-actions">
        <Button disabled={!selectedIds.size || batch.isRunning} onClick={() => void batch.run(files.filter(f => selectedIds.has(f.id)), 'retry')}>批量重试</Button>
        <Button disabled={!selectedIds.size || batch.isRunning} onClick={() => void batch.run(files.filter(f => selectedIds.has(f.id)), 'delete')} variant="link">批量移入回收站</Button>
      </div> : null}
      <BatchOperationSummary result={batch.result} />

      {visibleFiles.length > 0 ? (
        <div className="file-list" aria-label="团队资料列表">
          {visibleFiles.map((file) => (
            <article
              className={file.id === selectedFileId ? 'file-row file-row--active' : 'file-row'}
              key={file.id}
            >
              {fileService ? <input aria-label={`选择 ${file.displayName}`} checked={selectedIds.has(file.id)} onChange={event => setSelectedIds(current => { const next = new Set(current); event.target.checked ? next.add(file.id) : next.delete(file.id); return next; })} type="checkbox" /> : null}
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
      ) : files.length > 0 && !isLoading && !error ? (
        <p className="message">当前筛选没有匹配文件</p>
      ) : null}
    </Card>
  );
}
