import { useEffect, useRef, useState } from 'react';
import {
  SearchServiceError,
  type SearchErrorKind,
  type SearchResultSummary,
  type SearchService
} from './searchService';

interface SearchState {
  canRetry: boolean;
  errorKind: SearchErrorKind | null;
  error: string | null;
  isSearching: boolean;
  retry: () => Promise<void>;
  results: SearchResultSummary[];
  search: (query: string) => Promise<void>;
  searchedQuery: string | null;
}

function errorState(error: unknown): { kind: SearchErrorKind; message: string } {
  if (error instanceof SearchServiceError) {
    return { kind: error.kind, message: error.message };
  }
  return { kind: 'unknown', message: '搜索失败，请稍后重试' };
}

export function useSearch(
  searchService: SearchService,
  workspaceId: string,
  onSuccess?: (query: string, requestId: number) => void
): SearchState {
  const requestSequence = useRef(0);
  const workspaceGeneration = useRef(0);
  const onSuccessRef = useRef(onSuccess);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<SearchErrorKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResultSummary[]>([]);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    workspaceGeneration.current += 1;
    requestSequence.current += 1;
    setIsSearching(false);
    setError(null);
    setErrorKind(null);
    setResults([]);
    setSearchedQuery(null);
    setLastQuery(null);
  }, [workspaceId]);

  async function search(query: string) {
    const requestId = ++requestSequence.current;
    const generation = workspaceGeneration.current;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setIsSearching(false);
      setError('请输入搜索内容');
      setErrorKind('unknown');
      setResults([]);
      setSearchedQuery(null);
      setLastQuery(null);
      return;
    }

    setIsSearching(true);
    setError(null);
    setErrorKind(null);
    setLastQuery(normalizedQuery);
    setSearchedQuery(normalizedQuery);
    try {
      const nextResults = await searchService.search({ query: normalizedQuery, workspaceId });
      if (generation === workspaceGeneration.current) {
        onSuccessRef.current?.(normalizedQuery, requestId);
      }
      if (requestId !== requestSequence.current) {
        return;
      }
      setResults(nextResults);
    } catch (caughtError) {
      if (requestId !== requestSequence.current) {
        return;
      }
      const nextError = errorState(caughtError);
      setResults([]);
      setError(nextError.message);
      setErrorKind(nextError.kind);
    } finally {
      if (requestId === requestSequence.current) {
        setIsSearching(false);
      }
    }
  }

  async function retry() {
    if (lastQuery) {
      await search(lastQuery);
    }
  }

  return {
    canRetry: Boolean(lastQuery && error && (errorKind === 'network' || errorKind === 'unknown')),
    errorKind,
    error,
    isSearching,
    results,
    retry,
    search,
    searchedQuery
  };
}
