import { Button } from './ui/Button';
import type { SearchHistoryItem } from '../search/searchHistoryService';

interface SearchHistoryProps {
  error?: string | null;
  isClearing?: boolean;
  isLoading: boolean;
  items: SearchHistoryItem[];
  onClear: () => void;
  onRetry?: () => void;
  onSelect: (query: string) => void;
}

export function SearchHistory({
  error = null,
  isClearing = false,
  isLoading,
  items,
  onClear,
  onRetry,
  onSelect
}: SearchHistoryProps) {
  return (
    <section className="search-history" aria-label="搜索历史">
      <div className="search-history__header">
        <h3>最近搜索</h3>
        {items.length > 0 ? (
          <Button
            aria-label="清空搜索历史"
            disabled={isClearing}
            onClick={onClear}
            variant="link"
          >
            {isClearing ? '正在清空…' : '清空'}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="search-history__status" role="status">
          正在读取搜索历史…
        </p>
      ) : null}

      {!isLoading && error ? (
        <div className="search-history__error" role="alert">
          <p>{error}</p>
          {onRetry ? (
            <Button onClick={onRetry} variant="link">
              重试读取搜索历史
            </Button>
          ) : null}
        </div>
      ) : null}

      {!isLoading && !error && items.length === 0 ? (
        <div className="search-history__empty">
          <p>暂无搜索历史</p>
          <span>成功搜索后会显示在这里。</span>
        </div>
      ) : null}

      {!isLoading && items.length > 0 ? (
        <div className="search-history__list">
          {items.map((item) => (
            <Button
              aria-label={`搜索历史：${item.query}`}
              className="search-history__item"
              key={item.id}
              onClick={() => onSelect(item.query)}
              variant="link"
            >
              {item.query}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
