import { getSupabaseBrowserClient } from '../lib/supabaseClient';

export interface DeletedFileSummary {
  deletedAt: string;
  displayName: string;
  fileId: string;
  purgeAt: string;
  workspaceId: string;
}

export interface DeleteOperationResult {
  cleanupJobId: string;
  status: 'cleanup_pending';
}

export interface RecycleBinService {
  listDeletedFiles(workspaceId: string): Promise<DeletedFileSummary[]>;
  restoreFile(fileId: string): Promise<void>;
  permanentlyDeleteFile(fileId: string): Promise<DeleteOperationResult>;
}

export class RecycleBinServiceError extends Error {
  constructor(
    message: string,
    readonly kind: 'authentication' | 'permission' | 'not_found' | 'conflict' | 'unknown'
  ) {
    super(message);
    this.name = 'RecycleBinServiceError';
  }
}

function mapError(error: unknown): RecycleBinServiceError {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (code === '42501' || message.includes('membership') || message.includes('management')) {
    return new RecycleBinServiceError('暂无权限操作此文件，请确认团队权限。', 'permission');
  }
  if (code === 'P0002' || message.includes('not found')) {
    return new RecycleBinServiceError('文件不存在或已被清理。', 'not_found');
  }
  if (message.includes('authentication') || code === '401') {
    return new RecycleBinServiceError('登录状态已失效，请重新登录。', 'authentication');
  }
  if (message.includes('cleanup') || message.includes('already')) {
    return new RecycleBinServiceError('文件当前正在清理，请稍后重试。', 'conflict');
  }
  return new RecycleBinServiceError('回收站操作失败，请稍后重试。', 'unknown');
}

export const defaultRecycleBinService: RecycleBinService = {
  async listDeletedFiles(workspaceId) {
    const { data, error } = await getSupabaseBrowserClient().rpc('list_deleted_files', {
      p_workspace_id: workspaceId
    });
    if (error) throw mapError(error);
    return (data ?? []) as DeletedFileSummary[];
  },
  async restoreFile(fileId) {
    const { error } = await getSupabaseBrowserClient().rpc('restore_file', { p_file_id: fileId });
    if (error) throw mapError(error);
  },
  async permanentlyDeleteFile(fileId) {
    const { data, error } = await getSupabaseBrowserClient().rpc('permanently_delete_file', {
      p_file_id: fileId
    });
    if (error) throw mapError(error);
    if (!data || typeof data !== 'object') throw new RecycleBinServiceError('清理任务创建失败，请稍后重试。', 'unknown');
    return data as DeleteOperationResult;
  }
};
