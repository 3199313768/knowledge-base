import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SearchHistoryItem,
  SearchHistoryService
} from './searchHistoryService';
import { SearchHistoryServiceError } from './searchHistoryService';

interface SearchHistoryState {
  clear: () => Promise<void>;
  error: string | null;
  isClearing: boolean;
  isLoading: boolean;
  items: SearchHistoryItem[];
  load: () => Promise<void>;
  record: (query: string) => Promise<void>;
}

function safeMessage(error: unknown) {
  return error instanceof SearchHistoryServiceError
    ? error.message
    : '搜索历史操作失败，请稍后重试';
}

export function useSearchHistory(
  searchHistoryService: SearchHistoryService,
  workspaceId: string
): SearchHistoryState {
  const requestSequence = useRef(0);
  const operationSequence = useRef(0);
  const workspaceGeneration = useRef(0);
  const [items, setItems] = useState<SearchHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);

  const load = useCallback(async (expectedGeneration = workspaceGeneration.current) => {
    const requestId = ++requestSequence.current;
    const operationId = operationSequence.current;
    if (expectedGeneration !== workspaceGeneration.current) return;
    setIsLoading(true);
    setIsClearing(false);
    setError(null);
    setItems([]);
    try {
      const nextItems = await searchHistoryService.list(workspaceId, 20);
      if (
        requestId !== requestSequence.current ||
        expectedGeneration !== workspaceGeneration.current ||
        operationId !== operationSequence.current
      ) {
        return;
      }
      setItems(nextItems);
    } catch (caughtError) {
      if (
        requestId !== requestSequence.current ||
        expectedGeneration !== workspaceGeneration.current ||
        operationId !== operationSequence.current
      ) {
        return;
      }
      setItems([]);
      setError(safeMessage(caughtError));
    } finally {
      if (
        requestId === requestSequence.current &&
        expectedGeneration === workspaceGeneration.current &&
        operationId === operationSequence.current
      ) {
        setIsLoading(false);
      }
    }
  }, [searchHistoryService, workspaceId]);

  useEffect(() => {
    const generation = ++workspaceGeneration.current;
    void load(generation);
    return () => {
      workspaceGeneration.current += 1;
      requestSequence.current += 1;
      operationSequence.current += 1;
    };
  }, [load]);

  const record = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      const generation = workspaceGeneration.current;
      const operationId = ++operationSequence.current;
      try {
        await searchHistoryService.record({ workspaceId, query });
        if (
          generation !== workspaceGeneration.current ||
          operationId !== operationSequence.current
        ) {
          return;
        }
        await load(generation);
      } catch (caughtError) {
        if (
          generation !== workspaceGeneration.current ||
          operationId !== operationSequence.current
        ) {
          return;
        }
        setError(safeMessage(caughtError));
      }
    },
    [load, searchHistoryService, workspaceId]
  );

  const clear = useCallback(async () => {
    const generation = workspaceGeneration.current;
    const operationId = ++operationSequence.current;
    setIsClearing(true);
    setError(null);
    try {
      await searchHistoryService.clear(workspaceId);
      if (
        generation !== workspaceGeneration.current ||
        operationId !== operationSequence.current
      ) {
        return;
      }
      setItems([]);
    } catch (caughtError) {
      if (
        generation !== workspaceGeneration.current ||
        operationId !== operationSequence.current
      ) {
        return;
      }
      setError(safeMessage(caughtError));
    } finally {
      if (
        generation === workspaceGeneration.current &&
        operationId === operationSequence.current
      ) {
        setIsClearing(false);
      }
    }
  }, [searchHistoryService, workspaceId]);

  return { clear, error, isClearing, isLoading, items, load, record };
}
