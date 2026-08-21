import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileService, FileSummary } from './fileService';
import { useFiles } from './useFiles';

const file = (id: string): FileSummary => ({
  currentVersion: {
    canRetry: false,
    id: `${id}-version`,
    maxRetryCount: 3,
    mimeType: 'application/pdf',
    retryCount: 0,
    sizeBytes: 12,
    status: 'searchable'
  },
  displayName: `${id}.pdf`,
  id,
  updatedAt: '2026-08-21T08:00:00.000Z'
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

describe('useFiles', () => {
  it('clears loaded workspace data immediately while the next workspace is loading', async () => {
    const nextWorkspace = deferred<FileSummary[]>();
    const service: FileService = {
      getFilePreviewUrl: vi.fn(),
      listFiles: vi.fn((workspaceId: string) =>
        workspaceId === 'workspace-a' ? Promise.resolve([file('old-file')]) : nextWorkspace.promise
      ),
      retryFileVersion: vi.fn(),
      softDeleteFile: vi.fn()
    };
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useFiles(service, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );
    await waitFor(() => expect(result.current.files).toEqual([file('old-file')]));

    rerender({ workspaceId: 'workspace-b' });

    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.lastRefreshedAt).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await act(async () => nextWorkspace.resolve([file('new-file')]));
  });

  it('ignores a previous workspace response after switching workspaces', async () => {
    const first = deferred<FileSummary[]>();
    const second = deferred<FileSummary[]>();
    const service: FileService = {
      getFilePreviewUrl: vi.fn(),
      listFiles: vi.fn((workspaceId: string) =>
        workspaceId === 'workspace-a' ? first.promise : second.promise
      ),
      retryFileVersion: vi.fn(),
      softDeleteFile: vi.fn()
    };
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useFiles(service, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );

    rerender({ workspaceId: 'workspace-b' });
    await act(async () => second.resolve([file('new-file')]));
    await act(async () => first.resolve([file('old-file')]));

    await waitFor(() => expect(result.current.files).toEqual([file('new-file')]));
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps the newest overlapping refresh result', async () => {
    const older = deferred<FileSummary[]>();
    const newer = deferred<FileSummary[]>();
    let calls = 0;
    const service: FileService = {
      getFilePreviewUrl: vi.fn(),
      listFiles: vi.fn(() => {
        calls += 1;
        return calls === 1 ? older.promise : newer.promise;
      }),
      retryFileVersion: vi.fn(),
      softDeleteFile: vi.fn()
    };
    const { result } = renderHook(() => useFiles(service, 'workspace-a'));
    await waitFor(() => expect(service.listFiles).toHaveBeenCalledTimes(1));

    let firstRefresh: Promise<void> = Promise.resolve();
    let secondRefresh: Promise<void> = Promise.resolve();
    act(() => {
      firstRefresh = result.current.refreshFiles();
      secondRefresh = result.current.refreshFiles();
    });
    await act(async () => newer.resolve([file('new-file')]));
    await act(async () => older.resolve([file('old-file')]));
    await firstRefresh;
    await secondRefresh;

    expect(result.current.files).toEqual([file('new-file')]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('converges to a safe error and clears loading after a failed refresh', async () => {
    const service: FileService = {
      getFilePreviewUrl: vi.fn(),
      listFiles: vi.fn(async () => {
        throw new Error('permission denied token=secret');
      }),
      retryFileVersion: vi.fn(),
      softDeleteFile: vi.fn()
    };
    const { result } = renderHook(() => useFiles(service, 'workspace-a'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('读取文件失败，请稍后重试');
    expect(result.current.error).not.toContain('secret');
    expect(result.current.files).toEqual([]);
  });
});
