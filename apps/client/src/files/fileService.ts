import { getSupabaseBrowserClient } from '../lib/supabaseClient';

export type FileVersionStatus =
  | 'awaiting_upload'
  | 'pending_processing'
  | 'processing'
  | 'searchable'
  | 'partially_searchable'
  | 'failed';

export interface FileVersionSummary {
  canRetry?: boolean;
  id: string;
  lastError?: string | null;
  maxRetryCount?: number;
  mimeType: string | null;
  retryCount?: number;
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
export const MAX_FILE_RETRY_COUNT = 3;

export type FileOperationErrorKind =
  | 'authentication'
  | 'configuration'
  | 'conflict'
  | 'network'
  | 'not_found'
  | 'permission'
  | 'retry_limit'
  | 'unknown'
  | 'validation';

const FILE_OPERATION_MESSAGES: Record<FileOperationErrorKind, string> = {
  authentication: '登录状态已失效，请重新登录',
  configuration: '文件服务暂不可用，请检查应用配置后重试',
  conflict: '文件状态已变化，请刷新后重试',
  network: '网络异常，文件操作未完成，请检查网络后重试',
  not_found: '文件不存在或已被删除，请刷新文件列表',
  permission: '暂无权限操作当前团队文件，请确认团队权限',
  retry_limit: '已达到文件重试次数上限，请稍后联系管理员',
  unknown: '文件操作失败，请稍后重试',
  validation: '文件操作参数无效，请检查后重试'
};

export class FileOperationError extends Error {
  readonly canRetry: boolean;
  readonly kind: FileOperationErrorKind;

  constructor(kind: FileOperationErrorKind, message: string, canRetry: boolean) {
    super(message);
    this.name = 'FileOperationError';
    this.canRetry = canRetry;
    this.kind = kind;
  }
}

interface FileVersionRow {
  error_code?: string | null;
  id: string;
  mime_type: string | null;
  processing_jobs?: ProcessingJobRow[] | null;
  size_bytes: number | null;
  status: FileVersionStatus | null;
}

interface ProcessingJobRow {
  attempts: number | null;
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

interface FileErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

export function toFileOperationError(
  error: unknown,
  fallbackKind: FileOperationErrorKind = 'unknown',
  fallbackMessage?: string
): FileOperationError {
  if (error instanceof FileOperationError) {
    return error;
  }

  const candidate = (error && typeof error === 'object' ? error : {}) as FileErrorLike;
  const code = candidate.code?.toUpperCase();
  const message = candidate.message?.toLowerCase() ?? '';

  if (message.includes('authentication required')) {
    return new FileOperationError('authentication', FILE_OPERATION_MESSAGES.authentication, false);
  }
  if (message.includes('file management required')) {
    return new FileOperationError('permission', FILE_OPERATION_MESSAGES.permission, false);
  }
  if (message.includes('file version not found')) {
    return new FileOperationError(
      'not_found',
      '文件版本不存在或已被删除，请刷新文件列表',
      false
    );
  }
  if (
    message.includes('file version is not failed') ||
    message.includes('file version has no failed processing job')
  ) {
    return new FileOperationError('conflict', '文件当前状态不支持重新处理，请刷新后重试', false);
  }
  if (code === '42501' || candidate.status === 401 || candidate.status === 403 || message.includes('permission denied')) {
    return new FileOperationError('permission', FILE_OPERATION_MESSAGES.permission, false);
  }
  if (code === 'PGRST202' || code === '42883' || message.includes('could not find the function')) {
    return new FileOperationError('configuration', FILE_OPERATION_MESSAGES.configuration, true);
  }
  if (message.includes('supabase 客户端配置缺失')) {
    return new FileOperationError('configuration', FILE_OPERATION_MESSAGES.configuration, true);
  }
  if (message.includes('retry limit') || message.includes('too many retries') || code === 'RETRY_LIMIT') {
    return new FileOperationError('retry_limit', FILE_OPERATION_MESSAGES.retry_limit, false);
  }
  if (code === '409' || candidate.status === 409 || message.includes('conflict')) {
    return new FileOperationError('conflict', FILE_OPERATION_MESSAGES.conflict, true);
  }
  if (
    error instanceof TypeError ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return new FileOperationError('network', FILE_OPERATION_MESSAGES.network, true);
  }
  if (fallbackKind === 'validation') {
    return new FileOperationError('validation', fallbackMessage ?? FILE_OPERATION_MESSAGES.validation, false);
  }
  return new FileOperationError(
    fallbackKind,
    fallbackMessage ?? FILE_OPERATION_MESSAGES[fallbackKind],
    true
  );
}

function getFileClient() {
  try {
    return getSupabaseBrowserClient();
  } catch (error) {
    throw toFileOperationError(error);
  }
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
      throw new FileOperationError('validation', FILE_PREVIEW_ERROR_MESSAGE, false);
    }

    const supabase = getFileClient();
    const { data: storagePath, error: pathError } = await supabase.rpc(
      'get_file_storage_path',
      { p_file_id: fileId }
    );

    if (pathError || typeof storagePath !== 'string' || storagePath.length === 0) {
      throw new FileOperationError('unknown', FILE_PREVIEW_ERROR_MESSAGE, true);
    }

    const { data: signedUrl, error: storageError } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 300);

    if (storageError || !signedUrl?.signedUrl) {
      throw new FileOperationError('unknown', FILE_PREVIEW_ERROR_MESSAGE, true);
    }

    return signedUrl.signedUrl;
  },

  async listFiles(workspaceId) {
    const supabase = getFileClient();
    const { data, error } = await supabase
      .from('files')
      .select(
        'id,display_name,updated_at,current_version:file_versions!files_current_version_fk(id,status,size_bytes,mime_type,error_code,processing_jobs(attempts))'
      )
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    if (error) {
      throw toFileOperationError(error);
    }

    return ((data ?? []) as FileRow[]).map((file) => {
      const version = normalizeVersion(file.current_version);
      const retryCount = Math.max(
        0,
        ...(version?.processing_jobs ?? []).map((job) => job.attempts ?? 0)
      );

      return {
        currentVersion: version
          ? {
              canRetry: version.status === 'failed' && retryCount < MAX_FILE_RETRY_COUNT,
              id: version.id,
              lastError: version.error_code ?? null,
              maxRetryCount: MAX_FILE_RETRY_COUNT,
              mimeType: version.mime_type,
              retryCount,
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
    if (!versionId.trim()) {
      throw toFileOperationError(null, 'validation', '文件版本 ID 无效');
    }
    const supabase = getFileClient();
    const { error } = await supabase.rpc('retry_file_version', {
      p_version_id: versionId
    });

    if (error) {
      throw toFileOperationError(error);
    }
  },

  async softDeleteFile(fileId) {
    if (!fileId.trim()) {
      throw toFileOperationError(null, 'validation', '文件 ID 无效');
    }
    const supabase = getFileClient();
    const { error } = await supabase.rpc('soft_delete_file', {
      p_file_id: fileId
    });

    if (error) {
      throw toFileOperationError(error);
    }
  }
};
