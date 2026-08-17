import { useState } from 'react';
import type { SearchResultSummary, SearchService } from './searchService';

interface SearchState {
  error: string | null;
  isSearching: boolean;
  results: SearchResultSummary[];
  search: (query: string) => Promise<void>;
  searchedQuery: string | null;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : '搜索失败';
}

export function useSearch(
  searchService: SearchService,
  workspaceId: string
): SearchState {
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResultSummary[]>([]);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);

  async function search(query: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setError('请输入搜索内容');
      setResults([]);
      setSearchedQuery(null);
      return;
    }

    setIsSearching(true);
    setError(null);
    setSearchedQuery(normalizedQuery);
    try {
      setResults(await searchService.search({ query: normalizedQuery, workspaceId }));
    } catch (caughtError) {
      setResults([]);
      setError(safeMessage(caughtError));
    } finally {
      setIsSearching(false);
    }
  }

  return {
    error,
    isSearching,
    results,
    search,
    searchedQuery
  };
}
