import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchResults } from './SearchResults';
import type { SearchResultSummary } from '../search/searchService';

const result: SearchResultSummary = {
  fileId: 'file-a',
  fileName: '产品方案.pdf',
  score: 0.42,
  snippet: '年度报价策略',
  sourceLabel: '第 3 页'
};

describe('SearchResults', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows a loading status while the search is running', () => {
    render(
      <SearchResults
        errorKind={null}
        isLoading
        onOpenFile={vi.fn()}
        onRetry={vi.fn()}
        query="报价"
        results={[]}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('正在搜索…');
    expect(screen.getByRole('status')).toHaveClass('oxygen-status-message');
  });

  it('shows an empty state after a completed search with no matches', () => {
    render(
      <SearchResults
        errorKind={null}
        isLoading={false}
        onOpenFile={vi.fn()}
        onRetry={vi.fn()}
        query="不存在的内容"
        results={[]}
      />
    );

    expect(screen.getByRole('heading', { name: '没有找到匹配资料' })).toBeInTheDocument();
    expect(screen.getByText('可以换一个关键词，或等待文件处理完成后再试。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '没有找到匹配资料' }).closest('.oxygen-empty-state')).toBeInTheDocument();
  });

  it('shows a safe retry action for a retryable error', () => {
    const onRetry = vi.fn();
    render(
      <SearchResults
        errorKind="network"
        isLoading={false}
        onOpenFile={vi.fn()}
        onRetry={onRetry}
        query="报价"
        results={[]}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('网络异常，搜索未完成，请检查网络后重试');
    fireEvent.click(screen.getByRole('button', { name: '重试搜索' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the stable error message supplied by the search state', () => {
    render(
      <SearchResults
        error="请输入搜索内容"
        errorKind="unknown"
        isLoading={false}
        onOpenFile={vi.fn()}
        query={null}
        results={[]}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('请输入搜索内容');
    expect(screen.getByRole('alert')).not.toHaveTextContent('搜索失败，请稍后重试');
  });

  it('does not render an arbitrary raw error when no safe message is provided', () => {
    render(
      <SearchResults
        errorKind={null}
        isLoading={false}
        onOpenFile={vi.fn()}
        onRetry={vi.fn()}
        query="报价"
        results={[]}
      />
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('permission denied for function search_workspace_files')).not.toBeInTheDocument();
  });

  it('renders a result and opens the file through its accessible action', () => {
    const onOpenFile = vi.fn();
    render(
      <SearchResults
        errorKind={null}
        isLoading={false}
        onOpenFile={onOpenFile}
        onRetry={vi.fn()}
        query="报价"
        results={[result]}
      />
    );

    expect(screen.getByRole('heading', { name: '产品方案.pdf' })).toBeInTheDocument();
    expect(screen.getByText('年度报价策略')).toBeInTheDocument();
    expect(screen.getByText('第 3 页')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开文件 产品方案.pdf' }));
    expect(onOpenFile).toHaveBeenCalledWith('file-a');
  });
});
