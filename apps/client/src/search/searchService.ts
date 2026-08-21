import { getSupabaseBrowserClient } from '../lib/supabaseClient';

export interface SearchFilesInput {
  query: string;
  workspaceId: string;
}

export interface SearchResultSummary {
  fileId: string;
  fileName: string;
  score: number;
  snippet: string;
  sourceLabel: string;
}

export type SearchErrorKind = 'configuration' | 'permission' | 'network' | 'unknown';

export class SearchServiceError extends Error {
  readonly kind: SearchErrorKind;

  constructor(kind: SearchErrorKind, message: string) {
    super(message);
    this.name = 'SearchServiceError';
    this.kind = kind;
  }
}

export interface SearchService {
  search: (input: SearchFilesInput) => Promise<SearchResultSummary[]>;
}

interface SearchRow {
  file_id: string;
  file_name: string;
  score: number;
  snippet: string | null;
  source_location: { label?: string } | null;
}

interface SearchErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

const SEARCH_ERROR_MESSAGES: Record<SearchErrorKind, string> = {
  configuration: '搜索服务暂不可用，请检查应用配置后重试',
  permission: '暂无权限搜索当前团队资料，请确认团队权限',
  network: '网络异常，搜索未完成，请检查网络后重试',
  unknown: '搜索失败，请稍后重试'
};

function classifySearchError(error: unknown): SearchServiceError {
  const candidate = (error && typeof error === 'object' ? error : {}) as SearchErrorLike;
  const code = candidate.code?.toUpperCase();
  const message = candidate.message?.toLowerCase() ?? '';

  if (code === '42501' || candidate.status === 401 || candidate.status === 403 || message.includes('permission denied')) {
    return new SearchServiceError('permission', SEARCH_ERROR_MESSAGES.permission);
  }
  if (code === 'PGRST202' || code === '42883' || message.includes('could not find the function')) {
    return new SearchServiceError('configuration', SEARCH_ERROR_MESSAGES.configuration);
  }
  if (message.includes('supabase 客户端配置缺失')) {
    return new SearchServiceError('configuration', SEARCH_ERROR_MESSAGES.configuration);
  }
  if (
    error instanceof TypeError ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  ) {
    return new SearchServiceError('network', SEARCH_ERROR_MESSAGES.network);
  }
  return new SearchServiceError('unknown', SEARCH_ERROR_MESSAGES.unknown);
}

export function tokenizeSearchQuery(text: string): string[] {
  const matches = text.normalize('NFKC').match(/[\p{Script=Han}]+|[\p{Letter}\p{Number}]+/gu) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const match of matches) {
    const token = match.toLowerCase();
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }

  return tokens.slice(0, 50);
}

export function neutralQueryVectorLiteral(): string {
  return `[${Array.from({ length: 384 }, () => '0').join(',')}]`;
}

export const defaultSearchService: SearchService = {
  async search({ query, workspaceId }) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new SearchServiceError('unknown', '请输入搜索内容');
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.rpc('search_workspace_files', {
        p_filters: {},
        p_limit: 20,
        p_query_embedding: neutralQueryVectorLiteral(),
        p_query_text: normalizedQuery,
        p_query_tokens: tokenizeSearchQuery(normalizedQuery),
        p_workspace_id: workspaceId
      });

      if (error) {
        throw error;
      }

      return ((data ?? []) as SearchRow[]).map((row) => ({
        fileId: row.file_id,
        fileName: row.file_name,
        score: row.score,
        snippet: row.snippet ?? '',
        sourceLabel: row.source_location?.label ?? '来源未知'
      }));
    } catch (error) {
      if (error instanceof SearchServiceError) {
        throw error;
      }
      throw classifySearchError(error);
    }
  }
};
