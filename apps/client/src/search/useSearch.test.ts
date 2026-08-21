import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchServiceError, type SearchResultSummary, type SearchService } from './searchService';
import { useSearch } from './useSearch';

describe('useSearch', () => {
  it('emits one success event for every successful overlapping request', async () => {
    let resolveA!: (value: SearchResultSummary[]) => void;
    let resolveB!: (value: SearchResultSummary[]) => void;
    const onSuccess = vi.fn();
    const searchService: SearchService = {
      search: vi.fn(({ query }) =>
        new Promise<SearchResultSummary[]>((resolve) => {
          if (query === 'A') resolveA = resolve;
          else resolveB = resolve;
        })
      )
    };
    const { result } = renderHook(() => useSearch(searchService, 'workspace-a', onSuccess));

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.search('A');
      second = result.current.search('B');
    });
    await act(async () => {
      resolveA([]);
      await first;
    });
    await act(async () => {
      resolveB([]);
      await second;
    });

    expect(onSuccess).toHaveBeenNthCalledWith(1, 'A', expect.any(Number));
    expect(onSuccess).toHaveBeenNthCalledWith(2, 'B', expect.any(Number));
    expect(onSuccess).toHaveBeenCalledTimes(2);
  });

  it('clears searching state when an empty query cancels an in-flight request', async () => {
    let resolveSearch: ((value: SearchResultSummary[]) => void) | undefined;
    const searchService: SearchService = {
      search: vi.fn(() => new Promise<SearchResultSummary[]>((resolve) => {
        resolveSearch = resolve;
      }))
    };
    const { result } = renderHook(() => useSearch(searchService, 'workspace-a'));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.search('进行中');
    });
    await waitFor(() => expect(result.current.isSearching).toBe(true));

    await act(async () => {
      await result.current.search('   ');
    });

    expect(result.current.isSearching).toBe(false);
    expect(result.current.error).toBe('请输入搜索内容');
    resolveSearch?.([]);
    await pending;
  });

  it('ignores an in-flight result after the workspace changes', async () => {
    let resolveSearch: ((value: SearchResultSummary[]) => void) | undefined;
    const searchService: SearchService = {
      search: vi.fn(() => new Promise<SearchResultSummary[]>((resolve) => {
        resolveSearch = resolve;
      }))
    };
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useSearch(searchService, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.search('资料');
    });
    rerender({ workspaceId: 'workspace-b' });
    resolveSearch?.([{ fileId: 'old', fileName: '旧团队.pdf', score: 1, snippet: '旧', sourceLabel: '第 1 页' }]);
    await act(async () => {
      await pending;
    });

    expect(result.current.results).toEqual([]);
  });

  it('keeps the newer result when an earlier request resolves last', async () => {
    let resolveFirst: ((value: SearchResultSummary[]) => void) | undefined;
    let resolveSecond: ((value: SearchResultSummary[]) => void) | undefined;
    const search: SearchService['search'] = vi.fn((input) => new Promise<SearchResultSummary[]>((resolve) => {
      if (input.query === '旧查询') {
        resolveFirst = resolve;
      } else {
        resolveSecond = resolve;
      }
    }));
    const searchService: SearchService = {
      search
    };
    const { result } = renderHook(() => useSearch(searchService, 'workspace-a'));

    let firstRequest: Promise<void>;
    let secondRequest: Promise<void>;
    act(() => {
      firstRequest = result.current.search('旧查询');
      secondRequest = result.current.search('新查询');
    });

    await act(async () => {
      resolveSecond?.([{ fileId: 'new-file', fileName: '新文件.pdf', score: 1, snippet: '新内容', sourceLabel: '第 1 页' }]);
      await secondRequest;
    });
    await act(async () => {
      resolveFirst?.([{ fileId: 'old-file', fileName: '旧文件.pdf', score: 1, snippet: '旧内容', sourceLabel: '第 1 页' }]);
      await firstRequest;
    });

    expect(result.current.searchedQuery).toBe('新查询');
    expect(result.current.results).toEqual([
      { fileId: 'new-file', fileName: '新文件.pdf', score: 1, snippet: '新内容', sourceLabel: '第 1 页' }
    ]);
  });

  it('exposes a retry action for network failures', async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new SearchServiceError('network', '网络异常，搜索未完成，请检查网络后重试'))
      .mockResolvedValueOnce([]);
    const searchService: SearchService = { search };
    const { result } = renderHook(() => useSearch(searchService, 'workspace-a'));

    await result.current.search('报价');

    await waitFor(() => expect(result.current.errorKind).toBe('network'));
    expect(result.current.canRetry).toBe(true);
    await result.current.retry();

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('does not mark permission failures as retryable', async () => {
    const searchService: SearchService = {
      search: vi.fn(async () => {
        throw new SearchServiceError('permission', '暂无权限搜索当前团队资料，请确认团队权限');
      })
    };
    const { result } = renderHook(() => useSearch(searchService, 'workspace-a'));

    await result.current.search('报价');

    await waitFor(() => expect(result.current.errorKind).toBe('permission'));
    expect(result.current.canRetry).toBe(false);
  });
});
