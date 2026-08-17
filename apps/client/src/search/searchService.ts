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

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '搜索失败';
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
      throw new Error('请输入搜索内容');
    }

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
      throw new Error(messageFrom(error));
    }

    return ((data ?? []) as SearchRow[]).map((row) => ({
      fileId: row.file_id,
      fileName: row.file_name,
      score: row.score,
      snippet: row.snippet ?? '',
      sourceLabel: row.source_location?.label ?? '来源未知'
    }));
  }
};
