import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseBrowserClient } from '../lib/supabaseClient';
import {
  defaultFileService,
  FileOperationError,
  formatFileSize,
  formatFileStatus,
  summarizeFileStatuses,
  type FileSummary
} from './fileService';

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseBrowserClient: vi.fn()
}));

beforeEach(() => {
  vi.mocked(getSupabaseBrowserClient).mockReset();
});

describe('fileService formatters', () => {
  it('maps file version statuses to Chinese labels', () => {
    expect(formatFileStatus('awaiting_upload')).toBe('等待上传');
    expect(formatFileStatus('pending_processing')).toBe('等待处理');
    expect(formatFileStatus('processing')).toBe('处理中');
    expect(formatFileStatus('searchable')).toBe('可搜索');
    expect(formatFileStatus('partially_searchable')).toBe('部分可搜索');
    expect(formatFileStatus('failed')).toBe('处理失败');
    expect(formatFileStatus(null)).toBe('未知状态');
  });

  it('formats file sizes for list display', () => {
    expect(formatFileSize(null)).toBe('大小未知');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('summarizes file processing statuses for the workspace status bar', () => {
    const files: FileSummary[] = [
      fileWithStatus('awaiting_upload'),
      fileWithStatus('processing'),
      fileWithStatus('searchable'),
      fileWithStatus('partially_searchable'),
      fileWithStatus('failed'),
      fileWithStatus(null)
    ];

    expect(summarizeFileStatuses(files)).toEqual({
      failed: 1,
      processing: 2,
      searchable: 2,
      total: 6,
      unknown: 1
    });
  });

});

describe('FileOperationError contract', () => {
  it('keeps a stable kind, safe message, and retryability', () => {
    const error = new FileOperationError(
      'permission',
      '暂无权限操作当前团队文件，请确认团队权限',
      false
    );

    expect(error).toMatchObject({
      canRetry: false,
      kind: 'permission',
      message: '暂无权限操作当前团队文件，请确认团队权限'
    });
    expect(error.name).toBe('FileOperationError');
  });
});

describe('defaultFileService contract', () => {
  it('loads current workspace files and maps the current version relation', async () => {
    const query = {
      eq: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      select: vi.fn()
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockResolvedValue({
      data: [
        {
          current_version: [
            {
              id: 'version-a',
              mime_type: 'application/pdf',
              processing_jobs: [{ attempts: 2 }],
              size_bytes: 1536,
              status: 'searchable'
            }
          ],
          display_name: '产品方案.pdf',
          id: 'file-a',
          updated_at: '2026-08-17T06:00:00.000Z'
        }
      ],
      error: null
    });
    const from = vi.fn(() => query);
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      from
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.listFiles('workspace-a')).resolves.toEqual([
      {
        currentVersion: {
          id: 'version-a',
          canRetry: false,
          lastError: null,
          maxRetryCount: 3,
          mimeType: 'application/pdf',
          retryCount: 2,
          sizeBytes: 1536,
          status: 'searchable'
        },
        displayName: '产品方案.pdf',
        id: 'file-a',
        updatedAt: '2026-08-17T06:00:00.000Z'
      }
    ]);
    expect(from).toHaveBeenCalledWith('files');
    expect(query.eq).toHaveBeenCalledWith('workspace_id', 'workspace-a');
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.order).toHaveBeenCalledWith('updated_at', { ascending: false });
  });

  it('calls the soft delete RPC for a file', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.softDeleteFile('file-a')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('soft_delete_file', {
      p_file_id: 'file-a'
    });
  });

  it('marks a failed version non-retryable when a processing job reached the retry limit', async () => {
    const query = {
      eq: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      select: vi.fn()
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockResolvedValue({
      data: [
        {
          current_version: {
            error_code: 'parse_failed',
            id: 'version-failed',
            mime_type: 'application/pdf',
            processing_jobs: [{ attempts: 3 }],
            size_bytes: 128,
            status: 'failed'
          },
          display_name: '失败文件.pdf',
          id: 'file-failed',
          updated_at: '2026-08-21T08:00:00.000Z'
        }
      ],
      error: null
    });
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      from: vi.fn(() => query)
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.listFiles('workspace-a')).resolves.toEqual([
      expect.objectContaining({
        currentVersion: expect.objectContaining({
          canRetry: false,
          lastError: 'parse_failed',
          maxRetryCount: 3,
          retryCount: 3,
          status: 'failed'
        })
      })
    ]);
  });

  it('calls the retry RPC for a failed file version', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.retryFileVersion('version-a')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('retry_file_version', {
      p_version_id: 'version-a'
    });
  });

  it('maps a retry-limit RPC failure to a non-retryable safe error', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: 'P0001', message: 'retry limit exceeded; token=secret' }
    }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.retryFileVersion('version-a')).rejects.toEqual(
      expect.objectContaining({
        canRetry: false,
        kind: 'retry_limit',
        message: '已达到文件重试次数上限，请稍后联系管理员'
      })
    );
  });

  it.each([
    ['authentication required', 'authentication', '登录状态已失效，请重新登录'],
    ['file management required', 'permission', '暂无权限操作当前团队文件，请确认团队权限'],
    ['file version is not failed', 'conflict', '文件当前状态不支持重新处理，请刷新后重试'],
    ['file version has no failed processing job', 'conflict', '文件当前状态不支持重新处理，请刷新后重试'],
    ['file version not found', 'not_found', '文件版本不存在或已被删除，请刷新文件列表']
  ])('maps retry RPC business error %s to a non-retryable stable error', async (message, kind, expectedMessage) => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'P0001', message } }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.retryFileVersion('version-a')).rejects.toEqual(
      expect.objectContaining({ canRetry: false, kind, message: expectedMessage })
    );
  });

  it('maps a browser client configuration failure to a safe file-service error', async () => {
    vi.mocked(getSupabaseBrowserClient).mockImplementation(() => {
      throw new Error('Supabase 客户端配置缺失');
    });

    await expect(defaultFileService.listFiles('workspace-a')).rejects.toEqual(
      expect.objectContaining({
        canRetry: true,
        kind: 'configuration',
        message: '文件服务暂不可用，请检查应用配置后重试'
      })
    );
  });

  it('resolves a permission-protected storage path and returns a signed preview URL', async () => {
    const rpc = vi.fn(async () => ({
      data: 'workspace-a/file-a/version-a.pdf',
      error: null
    }));
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://storage.example.test/signed/file-a' },
      error: null
    }));
    const from = vi.fn(() => ({ createSignedUrl }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc,
      storage: { from }
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.getFilePreviewUrl('file-a')).resolves.toBe(
      'https://storage.example.test/signed/file-a'
    );
    expect(rpc).toHaveBeenCalledWith('get_file_storage_path', {
      p_file_id: 'file-a'
    });
    expect(from).toHaveBeenCalledWith('documents');
    expect(createSignedUrl).toHaveBeenCalledWith(
      'workspace-a/file-a/version-a.pdf',
      300
    );
  });

  it('rejects when the protected path or signed URL is missing', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc,
      storage: { from: vi.fn() }
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.getFilePreviewUrl('missing-file')).rejects.toThrow(
      '文件预览暂不可用，请检查文件权限或稍后重试'
    );
  });

  it('maps permission and storage failures to a safe preview error', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' }
    }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc,
      storage: { from: vi.fn() }
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.getFilePreviewUrl('forbidden-file')).rejects.toThrow(
      '文件预览暂不可用，请检查文件权限或稍后重试'
    );

    const storageRpc = vi.fn(async () => ({
      data: 'workspace-a/file-a/version-a.pdf',
      error: null
    }));
    const createSignedUrl = vi.fn(async () => ({
      data: null,
      error: { message: 'storage permission denied' }
    }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc: storageRpc,
      storage: { from: vi.fn(() => ({ createSignedUrl })) }
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultFileService.getFilePreviewUrl('file-a')).rejects.toThrow(
      '文件预览暂不可用，请检查文件权限或稍后重试'
    );
  });
});

function fileWithStatus(
  status: NonNullable<FileSummary['currentVersion']>['status']
): FileSummary {
  return {
    currentVersion: {
      id: `version-${status ?? 'unknown'}`,
      mimeType: 'application/pdf',
      sizeBytes: 12,
      status
    },
    displayName: `${status ?? 'unknown'}.pdf`,
    id: `file-${status ?? 'unknown'}`,
    updatedAt: '2026-08-17T06:00:00.000Z'
  };
}
