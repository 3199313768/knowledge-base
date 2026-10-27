import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileStatusSummary, FileSummary } from '../files/fileService';
import { FileStatusCenter, type FileStatusFilter } from './FileStatusCenter';

function file(overrides: Partial<FileSummary> = {}): FileSummary {
  return {
    id: 'file-a',
    displayName: '员工手册.pdf',
    updatedAt: '2026-08-21T00:00:00.000Z',
    currentVersion: {
      id: 'version-a',
      mimeType: 'application/pdf',
      sizeBytes: 128,
      status: 'failed',
      canRetry: true,
      retryCount: 1,
      maxRetryCount: 3
    },
    ...overrides
  };
}

const summary: FileStatusSummary = {
  failed: 1,
  processing: 2,
  searchable: 3,
  total: 6,
  unknown: 0
};

describe('FileStatusCenter', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows status counts and exposes an accessible filter group', () => {
    const onFilterChange = vi.fn<(filter: FileStatusFilter) => void>();

    render(
      <FileStatusCenter
        files={[file()]}
        filter="all"
        onFilterChange={onFilterChange}
        onRetryFailed={vi.fn(async () => undefined)}
        summary={summary}
      />
    );

    expect(screen.getByRole('region', { name: '文件状态中心' })).toBeInTheDocument();
    expect(screen.getByText('状态总数：6 个文件')).toBeInTheDocument();
    expect(screen.getByLabelText('文件状态统计')).toHaveTextContent('处理中：2');
    expect(screen.getByLabelText('文件状态统计')).toHaveTextContent('可搜索：3');
    expect(screen.getByLabelText('文件状态统计')).toHaveTextContent('失败：1');

    const failedFilter = screen.getByRole('button', { name: '筛选失败 1' });
    expect(failedFilter).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(failedFilter);
    expect(onFilterChange).toHaveBeenCalledWith('failed');
  });

  it.each([
    ['loading', { isLoading: true }, '正在读取文件状态…'],
    ['error', { error: '文件列表暂时不可用，请稍后重试' }, '文件列表暂时不可用，请稍后重试']
  ])('renders the %s state', (_name, props, message) => {
    render(
      <FileStatusCenter
        {...props}
        files={[]}
        filter="all"
        onFilterChange={vi.fn()}
        onRetryFailed={vi.fn(async () => undefined)}
        summary={{ failed: 0, processing: 0, searchable: 0, total: 0, unknown: 0 }}
      />
    );

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText(message).closest('.oxygen-status-message')).toBeInTheDocument();
  });

  it('renders a useful empty state when there are no files', () => {
    render(
      <FileStatusCenter
        files={[]}
        filter="all"
        onFilterChange={vi.fn()}
        onRetryFailed={vi.fn(async () => undefined)}
        summary={{ failed: 0, processing: 0, searchable: 0, total: 0, unknown: 0 }}
      />
    );

    expect(screen.getByText('暂无文件状态')).toBeInTheDocument();
    expect(screen.getByText('上传文件后，这里会显示处理进度和失败重试入口。')).toBeInTheDocument();
    expect(screen.getByText('暂无文件状态').closest('.oxygen-empty-state')).toBeInTheDocument();
  });

  it('retries a failed file once and disables duplicate clicks while pending', async () => {
    let resolveRetry: (() => void) | undefined;
    const onRetryFailed = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRetry = resolve;
        })
    );

    render(
      <FileStatusCenter
        files={[file()]}
        filter="failed"
        onFilterChange={vi.fn()}
        onRetryFailed={onRetryFailed}
        summary={summary}
      />
    );

    const retryButton = screen.getByRole('button', { name: '重新处理 员工手册.pdf' });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(onRetryFailed).toHaveBeenCalledTimes(1);
    expect(retryButton).toBeDisabled();
    expect(screen.getByText('正在重新处理…')).toBeInTheDocument();

    resolveRetry?.();
    await waitFor(() => expect(retryButton).not.toBeDisabled());
    expect(screen.getByText('已提交重新处理')).toBeInTheDocument();
  });

  it('does not offer retry when the file reached the retry limit', () => {
    render(
      <FileStatusCenter
        files={[
          {
            ...file(),
            currentVersion: {
              ...file().currentVersion!,
              canRetry: false,
              retryCount: 3
            }
          }
        ]}
        filter="failed"
        onFilterChange={vi.fn()}
        onRetryFailed={vi.fn(async () => undefined)}
        summary={summary}
      />
    );

    expect(screen.getByText('已达到重试次数上限')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新处理 员工手册.pdf' })).not.toBeInTheDocument();
  });
});
