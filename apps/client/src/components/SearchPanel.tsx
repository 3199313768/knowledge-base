import { useState } from 'react';
import { useSearch } from '../search/useSearch';
import type { SearchService } from '../search/searchService';
import {
  defaultSearchHistoryService,
  type SearchHistoryService
} from '../search/searchHistoryService';
import { useSearchHistory } from '../search/useSearchHistory';
import { Button } from './ui/Button';
import { TextInput } from './ui/TextInput';
import { SearchHistory } from './SearchHistory';
import { SearchResults } from './SearchResults';

interface SearchPanelProps {
  searchService: SearchService;
  searchHistoryService?: SearchHistoryService;
  workspaceId: string;
  onOpenFile?: (fileId: string) => void;
}

export function SearchPanel({
  searchHistoryService = defaultSearchHistoryService,
  searchService,
  workspaceId,
  onOpenFile = () => undefined
}: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const historyState = useSearchHistory(searchHistoryService, workspaceId);
  const searchState = useSearch(searchService, workspaceId, (successfulQuery) => {
    void historyState.record(successfulQuery);
  });

  function runSearch(nextQuery: string) {
    void searchState.search(nextQuery);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runSearch(query);
  }

  return (
    <div className="search-panel">
      <form className="search-form" onSubmit={handleSubmit}>
        <TextInput
          aria-label="搜索当前团队资料"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入关键词"
          type="search"
          value={query}
        />
        <Button disabled={searchState.isSearching} type="submit" variant="primary">
          搜索
        </Button>
      </form>

      <SearchHistory
        error={historyState.error}
        isClearing={historyState.isClearing}
        isLoading={historyState.isLoading}
        items={historyState.items}
        onClear={historyState.clear}
        onRetry={historyState.load}
        onSelect={(nextQuery) => {
          setQuery(nextQuery);
          runSearch(nextQuery);
        }}
      />

      <SearchResults
        error={searchState.error}
        errorKind={searchState.errorKind}
        isLoading={searchState.isSearching}
        onOpenFile={onOpenFile}
        onRetry={searchState.canRetry ? searchState.retry : undefined}
        query={searchState.searchedQuery}
        results={searchState.results}
      />
    </div>
  );
}
