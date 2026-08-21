import type { SearchErrorKind, SearchResultSummary } from '../search/searchService';
import { Button } from './ui/Button';
import { SearchResultItem } from './SearchResultItem';

export interface SearchResultsProps {
  results: SearchResultSummary[];
  isLoading: boolean;
  errorKind: SearchErrorKind | null;
  error?: string | null;
  query: string | null;
  onRetry?: () => void;
  onOpenFile: (fileId: string) => void;
}

export function SearchResults({
  results,
  isLoading,
  errorKind,
  error,
  query,
  onRetry,
  onOpenFile
}: SearchResultsProps) {
  if (isLoading) {
    return (
      <p className="message" role="status">
        正在搜索…
      </p>
    );
  }

  if (errorKind) {
    const errorMessages: Record<SearchErrorKind, string> = {
      configuration: '搜索服务暂不可用，请检查应用配置后重试',
      permission: '暂无权限搜索当前团队资料，请确认团队权限',
      network: '网络异常，搜索未完成，请检查网络后重试',
      unknown: '搜索失败，请稍后重试'
    };
    return (
      <div className="message message--error" role="alert">
        <span>{error ?? errorMessages[errorKind]}</span>
        {onRetry ? (
          <Button aria-label="重试搜索" onClick={onRetry} variant="link">
            重试搜索
          </Button>
        ) : null}
      </div>
    );
  }

  if (query && results.length === 0) {
    return (
      <div className="search-empty">
        <h3>没有找到匹配资料</h3>
        <p>可以换一个关键词，或等待文件处理完成后再试。</p>
      </div>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <div aria-label="搜索结果" className="search-results">
      {results.map((result) => (
        <SearchResultItem key={result.fileId} onOpenFile={onOpenFile} result={result} />
      ))}
    </div>
  );
}
