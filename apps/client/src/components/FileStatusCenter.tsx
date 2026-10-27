import { EmptyState, StatusMessage } from '@oxygen-design/ui';
import { useState } from 'react';
import {
  toFileOperationError,
  type FileStatusSummary,
  type FileSummary
} from '../files/fileService';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

export type FileStatusFilter = 'all' | 'processing' | 'searchable' | 'failed';

interface FileStatusCenterProps {
  error?: string | null;
  files: FileSummary[];
  filter: FileStatusFilter;
  isLoading?: boolean;
  onFilterChange: (filter: FileStatusFilter) => void;
  onRetryFailed: (file: FileSummary) => Promise<void>;
  summary: FileStatusSummary;
}

const filterLabels: Array<{ filter: FileStatusFilter; label: string }> = [
  { filter: 'all', label: '全部' },
  { filter: 'processing', label: '处理中' },
  { filter: 'searchable', label: '可搜索' },
  { filter: 'failed', label: '失败' }
];

function failedFiles(files: FileSummary[]) {
  return files.filter((file) => file.currentVersion?.status === 'failed');
}

export function FileStatusCenter({
  error = null,
  files,
  filter,
  isLoading = false,
  onFilterChange,
  onRetryFailed,
  summary
}: FileStatusCenterProps) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  const hasFiles = summary.total > 0 || files.length > 0;
  const failed = failedFiles(files);

  async function retryFailed(file: FileSummary) {
    if (pendingIds.has(file.id) || file.currentVersion?.canRetry !== true) {
      return;
    }

    setPendingIds((current) => new Set(current).add(file.id));
    setOutcomes((current) => {
      const next = { ...current };
      delete next[file.id];
      return next;
    });
    try {
      await onRetryFailed(file);
      setOutcomes((current) => ({ ...current, [file.id]: '已提交重新处理' }));
    } catch (error) {
      const operationError = toFileOperationError(error);
      setOutcomes((current) => ({ ...current, [file.id]: operationError.message }));
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
    }
  }

  return (
    <Card
      aria-busy={isLoading}
      aria-label="文件状态中心"
      className="file-status-center"
      variant="muted"
    >
      <div className="file-status-center__header">
        <div>
          <p className="eyebrow">文件状态</p>
          <h2>处理进度</h2>
        </div>
        <p className="file-status-center__total">状态总数：{summary.total} 个文件</p>
      </div>

      <div aria-label="文件状态统计" className="file-status-center__stats">
        <span>处理中：{summary.processing}</span>
        <span>可搜索：{summary.searchable}</span>
        <span>失败：{summary.failed}</span>
      </div>

      <div aria-label="文件状态筛选" className="file-status-center__filters" role="group">
        {filterLabels.map(({ filter: nextFilter, label }) => {
          const count =
            nextFilter === 'all'
              ? summary.total
              : nextFilter === 'processing'
                ? summary.processing
                : nextFilter === 'searchable'
                  ? summary.searchable
                  : summary.failed;
          return (
            <Button
              aria-pressed={filter === nextFilter}
              aria-label={`筛选${label} ${count}`}
              className={filter === nextFilter ? 'file-status-center__filter--active' : undefined}
              key={nextFilter}
              onClick={() => onFilterChange(nextFilter)}
              variant="ghost"
            >
              {label}
            </Button>
          );
        })}
      </div>

      {isLoading ? <StatusMessage>正在读取文件状态…</StatusMessage> : null}
      {error ? (
        <StatusMessage tone="error">{error}</StatusMessage>
      ) : null}

      {!isLoading && !error && !hasFiles ? (
        <div className="file-status-center__empty">
          <EmptyState
            description="上传文件后，这里会显示处理进度和失败重试入口。"
            title="暂无文件状态"
          />
        </div>
      ) : null}

      {!isLoading && !error && hasFiles && (filter === 'failed' || filter === 'all') && failed.length > 0 ? (
        <div aria-label="失败文件列表" className="file-status-center__failed-list">
          {failed.map((file) => {
            const version = file.currentVersion;
            const pending = pendingIds.has(file.id);
            const canRetry = version?.canRetry === true;
            return (
              <div className="file-status-center__failed-item" key={file.id}>
                <div>
                  <strong>{file.displayName}</strong>
                  <span>
                    {version?.retryCount ?? 0}/{version?.maxRetryCount ?? '—'} 次重试
                  </span>
                </div>
                {canRetry ? (
                  <Button
                    aria-busy={pending}
                    aria-label={`重新处理 ${file.displayName}`}
                    disabled={pending}
                    onClick={() => void retryFailed(file)}
                    variant="ghost"
                  >
                    {pending ? '正在重新处理…' : '重新处理'}
                  </Button>
                ) : (
                  <span className="file-status-center__retry-limit">已达到重试次数上限</span>
                )}
                {outcomes[file.id] ? (
                  <span
                    aria-live="polite"
                    className="file-status-center__outcome"
                    role="status"
                  >
                    {outcomes[file.id]}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!isLoading && !error && hasFiles && filter === 'failed' && failed.length === 0 ? (
        <p className="message">当前筛选没有失败文件</p>
      ) : null}
    </Card>
  );
}

export function filterFilesByStatus(files: FileSummary[], filter: FileStatusFilter): FileSummary[] {
  if (filter === 'all') {
    return files;
  }

  return files.filter((file) => {
    const status = file.currentVersion?.status;
    if (filter === 'processing') {
      return status === 'awaiting_upload' || status === 'pending_processing' || status === 'processing';
    }
    if (filter === 'searchable') {
      return status === 'searchable' || status === 'partially_searchable';
    }
    return status === 'failed';
  });
}
