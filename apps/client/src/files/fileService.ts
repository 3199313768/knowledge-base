import { getSupabaseBrowserClient } from '../lib/supabaseClient';

export type FileVersionStatus =
  | 'awaiting_upload'
  | 'pending_processing'
  | 'processing'
  | 'searchable'
  | 'partially_searchable'
  | 'failed';

export interface FileVersionSummary {
  id: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: FileVersionStatus | null;
}

export interface FileSummary {
  currentVersion: FileVersionSummary | null;
  displayName: string;
  id: string;
  updatedAt: string | null;
}

export interface FileStatusSummary {
  failed: number;
  processing: number;
  searchable: number;
  total: number;
  unknown: number;
}

export interface FileService {
  getFilePreviewUrl: (fileId: string) => Promise<string>;
  listFiles: (workspaceId: string) => Promise<FileSummary[]>;
  retryFileVersion: (versionId: string) => Promise<void>;
  softDeleteFile: (fileId: string) => Promise<void>;
}

export const FILE_PREVIEW_ERROR_MESSAGE = '文件预览暂不可用，请检查文件权限或稍后重试';

interface FileVersionRow {
  id: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: FileVersionStatus | null;
}

interface FileRow {
  current_version: FileVersionRow | FileVersionRow[] | null;
  display_name: string;
  id: string;
  updated_at: string | null;
}

const STATUS_LABELS: Record<FileVersionStatus, string> = {
  awaiting_upload: '等待上传',
  failed: '处理失败',
  partially_searchable: '部分可搜索',
  pending_processing: '等待处理',
  processing: '处理中',
  searchable: '可搜索'
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '文件操作失败';
}

function normalizeVersion(
  version: FileVersionRow | FileVersionRow[] | null
): FileVersionRow | null {
  if (Array.isArray(version)) {
    return version[0] ?? null;
  }

  return version;
}

export function formatFileStatus(status: FileVersionStatus | null): string {
  return status ? STATUS_LABELS[status] ?? '未知状态' : '未知状态';
}

export function formatFileSize(sizeBytes: number | null): string {
  if (sizeBytes === null) {
    return '大小未知';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function summarizeFileStatuses(files: FileSummary[]): FileStatusSummary {
  return files.reduce<FileStatusSummary>(
    (summary, file) => {
      const status = file.currentVersion?.status ?? null;
      summary.total += 1;

      if (
        status === 'awaiting_upload' ||
        status === 'pending_processing' ||
        status === 'processing'
      ) {
        summary.processing += 1;
      } else if (status === 'searchable' || status === 'partially_searchable') {
        summary.searchable += 1;
      } else if (status === 'failed') {
        summary.failed += 1;
      } else {
        summary.unknown += 1;
      }

      return summary;
    },
    {
      failed: 0,
      processing: 0,
      searchable: 0,
      total: 0,
      unknown: 0
    }
  );
}

export const defaultFileService: FileService = {
  async getFilePreviewUrl(fileId) {
    if (!fileId.trim()) {
      throw new Error(FILE_PREVIEW_ERROR_MESSAGE);
    }

    const supabase = getSupabaseBrowserClient();
    const { data: storagePath, error: pathError } = await supabase.rpc(
      'get_file_storage_path',
      { p_file_id: fileId }
    );

    if (pathError || typeof storagePath !== 'string' || storagePath.length === 0) {
      throw new Error(FILE_PREVIEW_ERROR_MESSAGE);
    }

    const { data: signedUrl, error: storageError } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 300);

    if (storageError || !signedUrl?.signedUrl) {
      throw new Error(FILE_PREVIEW_ERROR_MESSAGE);
    }

    return signedUrl.signedUrl;
  },

  async listFiles(workspaceId) {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('files')
      .select(
        'id,display_name,updated_at,current_version:file_versions!files_current_version_fk(id,status,size_bytes,mime_type)'
      )
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(messageFrom(error));
    }

    return ((data ?? []) as FileRow[]).map((file) => {
      const version = normalizeVersion(file.current_version);

      return {
        currentVersion: version
          ? {
              id: version.id,
              mimeType: version.mime_type,
              sizeBytes: version.size_bytes,
              status: version.status
            }
          : null,
        displayName: file.display_name,
        id: file.id,
        updatedAt: file.updated_at
      };
    });
  },

  async retryFileVersion(versionId) {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.rpc('retry_file_version', {
      p_version_id: versionId
    });

    if (error) {
      throw new Error(messageFrom(error));
    }
  },

  async softDeleteFile(fileId) {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.rpc('soft_delete_file', {
      p_file_id: fileId
    });

    if (error) {
      throw new Error(messageFrom(error));
    }
  }
};
