import { getSupabaseBrowserClient } from '../lib/supabaseClient';

export interface SearchHistoryItem {
  id: string;
  query: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordSearchHistoryInput {
  workspaceId: string;
  query: string;
}

export type SearchHistoryErrorKind =
  | 'authentication'
  | 'configuration'
  | 'network'
  | 'permission'
  | 'unknown'
  | 'validation';

export class SearchHistoryServiceError extends Error {
  readonly kind: SearchHistoryErrorKind;

  constructor(kind: SearchHistoryErrorKind, message: string) {
    super(message);
    this.name = 'SearchHistoryServiceError';
    this.kind = kind;
  }
}

export interface SearchHistoryService {
  list: (workspaceId: string, limit: number) => Promise<SearchHistoryItem[]>;
  record: (input: RecordSearchHistoryInput) => Promise<void>;
  clear: (workspaceId: string) => Promise<void>;
}

interface SearchHistoryRow {
  id: string;
  query: string;
  created_at: string;
  updated_at: string;
}

interface SearchHistoryErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

const SEARCH_HISTORY_ERROR_MESSAGES: Record<Exclude<SearchHistoryErrorKind, 'validation'>, string> = {
  authentication: '请先登录后查看搜索历史',
  configuration: '搜索历史服务暂不可用，请检查应用配置后重试',
  network: '网络异常，搜索历史未完成，请检查网络后重试',
  permission: '暂无权限访问当前团队搜索历史，请确认团队权限',
  unknown: '搜索历史操作失败，请稍后重试'
};

const SEARCH_HISTORY_VALIDATION_ERROR = '请求参数无效，请检查后重试';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function classifySearchHistoryError(error: unknown): SearchHistoryServiceError {
  const candidate = (error && typeof error === 'object' ? error : {}) as SearchHistoryErrorLike;
  const code = candidate.code?.toUpperCase();
  const message = candidate.message?.toLowerCase() ?? '';

  if (code === '22023' || code === '22P02') {
    return new SearchHistoryServiceError('validation', SEARCH_HISTORY_VALIDATION_ERROR);
  }
  if (
    candidate.status === 401 ||
    message.includes('jwt') ||
    message.includes('auth session missing') ||
    message.includes('not authenticated') ||
    message.includes('authentication required')
  ) {
    return new SearchHistoryServiceError(
      'authentication',
      SEARCH_HISTORY_ERROR_MESSAGES.authentication
    );
  }
  if (
    code === '42501' ||
    candidate.status === 403 ||
    message.includes('permission denied') ||
    message.includes('row-level security')
  ) {
    return new SearchHistoryServiceError('permission', SEARCH_HISTORY_ERROR_MESSAGES.permission);
  }
  if (message.includes('supabase 客户端配置缺失')) {
    return new SearchHistoryServiceError(
      'configuration',
      SEARCH_HISTORY_ERROR_MESSAGES.configuration
    );
  }
  if (
    code === 'PGRST202' ||
    code === '42P01' ||
    code === '42883' ||
    message.includes('could not find the function') ||
    (message.includes('relation') && message.includes('does not exist'))
  ) {
    return new SearchHistoryServiceError(
      'configuration',
      SEARCH_HISTORY_ERROR_MESSAGES.configuration
    );
  }
  if (
    error instanceof TypeError ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return new SearchHistoryServiceError('network', SEARCH_HISTORY_ERROR_MESSAGES.network);
  }
  return new SearchHistoryServiceError('unknown', SEARCH_HISTORY_ERROR_MESSAGES.unknown);
}

function mapHistoryRow(row: SearchHistoryRow): SearchHistoryItem {
  return {
    id: row.id,
    query: row.query,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ensureWorkspaceId(workspaceId: string): string {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!UUID_PATTERN.test(normalizedWorkspaceId)) {
    throw new SearchHistoryServiceError('validation', '当前团队信息无效，请重新选择团队');
  }
  return normalizedWorkspaceId;
}

function ensureLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) {
    return 20;
  }
  return Math.min(Math.floor(limit), 50);
}

export const defaultSearchHistoryService: SearchHistoryService = {
  async list(workspaceId, limit) {
    const normalizedWorkspaceId = ensureWorkspaceId(workspaceId);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('search_history')
        .select('id,query,created_at,updated_at')
        .eq('workspace_id', normalizedWorkspaceId)
        .order('updated_at', { ascending: false })
        .limit(ensureLimit(limit));

      if (error) {
        throw error;
      }

      return ((data ?? []) as SearchHistoryRow[]).map(mapHistoryRow);
    } catch (error) {
      if (error instanceof SearchHistoryServiceError) {
        throw error;
      }
      throw classifySearchHistoryError(error);
    }
  },

  async record({ workspaceId, query }) {
    const normalizedWorkspaceId = ensureWorkspaceId(workspaceId);
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      throw new SearchHistoryServiceError('validation', '请输入有效的搜索内容');
    }
    if (Array.from(trimmedQuery).length > 500) {
      throw new SearchHistoryServiceError('validation', '搜索内容不能超过 500 个字符');
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.rpc('record_search_history', {
        p_workspace_id: normalizedWorkspaceId,
        p_query: query
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      if (error instanceof SearchHistoryServiceError) {
        throw error;
      }
      throw classifySearchHistoryError(error);
    }
  },

  async clear(workspaceId) {
    const normalizedWorkspaceId = ensureWorkspaceId(workspaceId);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('search_history')
        .delete()
        .eq('workspace_id', normalizedWorkspaceId);

      if (error) {
        throw error;
      }
    } catch (error) {
      if (error instanceof SearchHistoryServiceError) {
        throw error;
      }
      throw classifySearchHistoryError(error);
    }
  }
};
