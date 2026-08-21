import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UploadFileResult, UploadService } from './uploadService';
import { useUploadQueue } from './useUploadQueue';

const pdf = (name = '资料.pdf') => new File(['pdf'], name, { type: 'application/pdf' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe('useUploadQueue', () => {
  it('does not let an old A workspace finally remove a new A workspace upload key', async () => {
    const firstA = deferred<UploadFileResult>();
    const secondA = deferred<UploadFileResult>();
    let aCalls = 0;
    const uploadService: UploadService = {
      uploadFile: vi.fn(({ workspaceId }) =>
        workspaceId === 'workspace-a'
          ? (++aCalls === 1 ? firstA.promise : secondA.promise)
          : Promise.resolve({ fileId: 'file-b', outcome: 'uploaded' as const, versionId: 'version-b' })
      )
    };
    const sameFile = pdf('重复跨团队资料.pdf');
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useUploadQueue(uploadService, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );

    let firstUpload: Promise<UploadFileResult | null> = Promise.resolve(null);
    act(() => {
      firstUpload = result.current.uploadFile(sameFile);
    });
    rerender({ workspaceId: 'workspace-b' });
    rerender({ workspaceId: 'workspace-a' });
    let secondUpload: Promise<UploadFileResult | null> = Promise.resolve(null);
    act(() => {
      secondUpload = result.current.uploadFile(sameFile);
    });
    expect(uploadService.uploadFile).toHaveBeenCalledTimes(2);
    expect(result.current.isUploading).toBe(true);

    await act(async () => firstA.resolve({ fileId: 'old-a', outcome: 'uploaded', versionId: 'old-version' }));
    await firstUpload;
    expect(result.current.isUploading).toBe(true);
    expect(result.current.items[0]).toMatchObject({ status: 'uploading' });

    await act(async () => secondA.resolve({ fileId: 'new-a', outcome: 'uploaded', versionId: 'new-version' }));
    await secondUpload;
    expect(result.current.isUploading).toBe(false);
    expect(result.current.items[0]).toMatchObject({ status: 'uploaded', result: { fileId: 'new-a' } });
  });

  it('clears the previous workspace queue and accepts the same file in the next workspace', async () => {
    const pendingA = deferred<UploadFileResult>();
    const uploadService: UploadService = {
      uploadFile: vi.fn(({ workspaceId }) =>
        workspaceId === 'workspace-a'
          ? pendingA.promise
          : Promise.resolve({ fileId: 'file-b', outcome: 'uploaded' as const, versionId: 'version-b' })
      )
    };
    const sameFile = pdf('跨团队资料.pdf');
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useUploadQueue(uploadService, workspaceId),
      { initialProps: { workspaceId: 'workspace-a' } }
    );
    let uploadA: Promise<UploadFileResult | null> = Promise.resolve(null);
    act(() => {
      uploadA = result.current.uploadFile(sameFile);
    });
    expect(result.current.items).toHaveLength(1);

    rerender({ workspaceId: 'workspace-b' });
    expect(result.current.items).toEqual([]);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.lastFileName).toBeNull();
    await act(async () => pendingA.resolve({ fileId: 'file-a', outcome: 'uploaded', versionId: 'version-a' }));
    await uploadA;
    expect(result.current.items).toEqual([]);

    await act(async () => {
      await result.current.uploadFile(sameFile);
    });
    expect(uploadService.uploadFile).toHaveBeenCalledTimes(2);
    expect(result.current.items[0]).toMatchObject({ fileName: '跨团队资料.pdf', status: 'uploaded' });
  });

  it('keeps legacy result and error fields aligned with the latest started upload', async () => {
    const first = deferred<UploadFileResult>();
    const second = deferred<UploadFileResult>();
    const uploadService: UploadService = {
      uploadFile: vi.fn(({ file }) => (file.name === '慢文件.pdf' ? first.promise : second.promise))
    };
    const { result } = renderHook(() => useUploadQueue(uploadService, 'workspace-a'));
    let slowUpload: Promise<UploadFileResult | null> = Promise.resolve(null);
    let fastUpload: Promise<UploadFileResult | null> = Promise.resolve(null);
    act(() => {
      slowUpload = result.current.uploadFile(pdf('慢文件.pdf'));
      fastUpload = result.current.uploadFile(pdf('快文件.pdf'));
    });
    await act(async () => second.resolve({ fileId: 'fast', outcome: 'uploaded', versionId: 'fast-version' }));
    await fastUpload;
    await act(async () => first.reject(new Error('worker token=secret')));
    await slowUpload;

    expect(result.current.lastFileName).toBe('快文件.pdf');
    expect(result.current.lastResult).toEqual({ fileId: 'fast', outcome: 'uploaded', versionId: 'fast-version' });
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: '慢文件.pdf', status: 'failed' }),
        expect.objectContaining({ fileName: '快文件.pdf', status: 'uploaded' })
      ])
    );
  });

  it('does not submit the same file twice while the first request is pending', async () => {
    const pending = deferred<UploadFileResult>();
    const uploadService: UploadService = {
      uploadFile: vi.fn(() => pending.promise)
    };
    const { result } = renderHook(() => useUploadQueue(uploadService, 'workspace-a'));
    const selectedFile = pdf();
    let first: Promise<UploadFileResult | null> = Promise.resolve(null);
    let second: Promise<UploadFileResult | null> = Promise.resolve(null);

    act(() => {
      first = result.current.uploadFile(selectedFile);
      second = result.current.uploadFile(selectedFile);
    });

    expect(uploadService.uploadFile).toHaveBeenCalledTimes(1);
    expect(result.current.isUploading).toBe(true);
    await act(async () => pending.resolve({ fileId: 'file-a', outcome: 'uploaded', versionId: 'version-a' }));
    await first;
    await second;
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ status: 'uploaded', canRetry: false });
  });

  it('exposes duplicate outcome as a non-retryable per-file state', async () => {
    const uploadService: UploadService = {
      uploadFile: vi.fn(async () => ({ duplicateFileId: 'existing-file', outcome: 'duplicate' as const }))
    };
    const { result } = renderHook(() => useUploadQueue(uploadService, 'workspace-a'));

    await act(async () => {
      await result.current.uploadFile(pdf('重复.pdf'));
    });

    expect(result.current.lastResult).toEqual({ duplicateFileId: 'existing-file', outcome: 'duplicate' });
    expect(result.current.items[0]).toMatchObject({
      canRetry: false,
      duplicateFileId: 'existing-file',
      status: 'duplicate'
    });
    expect(result.current.error).toBeNull();
  });

  it('maps arbitrary upload errors to a safe retryable message', async () => {
    const uploadService: UploadService = {
      uploadFile: vi.fn(async () => {
        throw new Error('backend token=secret');
      })
    };
    const { result } = renderHook(() => useUploadQueue(uploadService, 'workspace-a'));

    await act(async () => {
      await result.current.uploadFile(pdf('失败.pdf'));
    });

    await waitFor(() => expect(result.current.isUploading).toBe(false));
    expect(result.current.error).toBe('上传失败，请稍后重试');
    expect(result.current.error).not.toContain('secret');
    expect(result.current.items[0]).toMatchObject({ status: 'failed', canRetry: true });
  });
});
