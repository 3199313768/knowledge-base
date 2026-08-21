import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  SearchHistoryServiceError,
  type SearchHistoryItem,
  type SearchHistoryService
} from './searchHistoryService';
import { useSearchHistory } from './useSearchHistory';

const item = (query: string): SearchHistoryItem => ({
  id: query,
  query,
  createdAt: '2026-08-21T08:00:00.000Z',
  updatedAt: '2026-08-21T09:00:00.000Z'
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe('useSearchHistory', () => {
  it('ignores a previous workspace list after the workspace changes', async () => {
    const first = deferred<SearchHistoryItem[]>();
    const second = deferred<SearchHistoryItem[]>();
    const list = vi.fn((workspaceId: string) =>
      workspaceId === 'workspace-a' ? first.promise : second.promise
    );
    const service: SearchHistoryService = {
      list,
      record: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    };
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useSearchHistory(service, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );

    rerender({ workspaceId: 'workspace-b' });
    await act(async () => second.resolve([item('新团队')]));
    await act(async () => first.resolve([item('旧团队')]));

    await waitFor(() => expect(result.current.items).toEqual([item('新团队')]));
    expect(result.current.error).toBeNull();
  });

  it('does not surface an old workspace list error after switching workspaces', async () => {
    const first = deferred<SearchHistoryItem[]>();
    const service: SearchHistoryService = {
      list: vi.fn((workspaceId: string) =>
        workspaceId === 'workspace-a' ? first.promise : Promise.resolve([item('新团队')])
      ),
      record: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    };
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useSearchHistory(service, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );

    rerender({ workspaceId: 'workspace-b' });
    await waitFor(() => expect(result.current.items).toEqual([item('新团队')]));
    await act(async () => first.reject(new SearchHistoryServiceError('network', '旧请求失败')));

    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([item('新团队')]);
  });

  it('ignores a previous workspace record failure', async () => {
    const recordRequest = deferred<void>();
    const service: SearchHistoryService = {
      list: vi.fn(async () => []),
      record: vi.fn(() => recordRequest.promise),
      clear: vi.fn(async () => undefined)
    };
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useSearchHistory(service, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.record('旧查询');
    });
    rerender({ workspaceId: 'workspace-b' });
    await act(async () => recordRequest.reject(new Error('raw secret backend detail')));
    await pending;

    expect(result.current.error).toBeNull();
  });

  it('ignores a previous workspace clear completion', async () => {
    const clearRequest = deferred<void>();
    const service: SearchHistoryService = {
      list: vi.fn(async () => [item('当前')]),
      record: vi.fn(async () => undefined),
      clear: vi.fn(() => clearRequest.promise)
    };
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useSearchHistory(service, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );
    await waitFor(() => expect(result.current.items).toEqual([item('当前')]));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.clear();
    });
    rerender({ workspaceId: 'workspace-b' });
    await act(async () => clearRequest.resolve());
    await pending;

    expect(result.current.items).toEqual([item('当前')]);
  });

  it('does not expose arbitrary Error messages in the UI state', async () => {
    const service: SearchHistoryService = {
      list: vi.fn(async () => {
        throw new Error('permission denied with token=secret');
      }),
      record: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    };
    const { result } = renderHook(() => useSearchHistory(service, 'workspace-a'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('搜索历史操作失败，请稍后重试');
    expect(result.current.error).not.toContain('secret');
  });

  it('can retry a failed history load with a stable service message', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new SearchHistoryServiceError('network', '网络异常，请稍后重试'))
      .mockResolvedValueOnce([item('重试成功')]);
    const service: SearchHistoryService = {
      list,
      record: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    };
    const { result } = renderHook(() => useSearchHistory(service, 'workspace-a'));

    await waitFor(() => expect(result.current.error).toBe('网络异常，请稍后重试'));
    await act(async () => result.current.load());

    await waitFor(() => expect(result.current.items).toEqual([item('重试成功')]));
    expect(result.current.error).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not let a record refresh overwrite a subsequent clear in the same workspace', async () => {
    const refresh = deferred<SearchHistoryItem[]>();
    let listCalls = 0;
    const service: SearchHistoryService = {
      list: vi.fn(async () => {
        listCalls += 1;
        if (listCalls === 1) return [item('初始')];
        return refresh.promise;
      }),
      record: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    };
    const { result } = renderHook(() => useSearchHistory(service, 'workspace-a'));
    await waitFor(() => expect(result.current.items).toEqual([item('初始')]));

    let recordPending: Promise<void> = Promise.resolve();
    act(() => {
      recordPending = result.current.record('新增');
    });
    await waitFor(() => expect(service.list).toHaveBeenCalledTimes(2));

    await act(async () => result.current.clear());
    expect(result.current.items).toEqual([]);

    await act(async () => refresh.resolve([item('过期刷新结果')]));
    await recordPending;
    expect(result.current.items).toEqual([]);
  });
});
