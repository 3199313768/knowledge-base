import { useState } from 'react';
import { useSearch } from '../search/useSearch';
import type { SearchService } from '../search/searchService';
import { Button } from './ui/Button';
import { TextInput } from './ui/TextInput';

interface SearchPanelProps {
  searchService: SearchService;
  workspaceId: string;
}

export function SearchPanel({ searchService, workspaceId }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const searchState = useSearch(searchService, workspaceId);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchState.search(query);
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

      {searchState.isSearching ? <p className="message">正在搜索…</p> : null}
      {searchState.error ? (
        <p className="message message--error">{searchState.error}</p>
      ) : null}
      {!searchState.isSearching &&
      !searchState.error &&
      searchState.searchedQuery &&
      searchState.results.length === 0 ? (
        <div className="search-empty">
          <h3>没有找到匹配资料</h3>
          <p>可以换一个关键词，或等待文件处理完成后再试。</p>
        </div>
      ) : null}

      {searchState.results.length > 0 ? (
        <div className="search-results" aria-label="搜索结果">
          {searchState.results.map((result) => (
            <article className="search-result" key={result.fileId}>
              <div>
                <h3>{result.fileName}</h3>
                <p>{result.snippet}</p>
              </div>
              <div className="search-result__meta">
                <span>{result.sourceLabel}</span>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
