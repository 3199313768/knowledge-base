import type { SearchResultSummary } from '../search/searchService';
import { Button } from './ui/Button';

interface SearchResultItemProps {
  result: SearchResultSummary;
  onOpenFile: (fileId: string) => void;
}

export function SearchResultItem({ result, onOpenFile }: SearchResultItemProps) {
  return (
    <article className="search-result">
      <div className="search-result__content">
        <h3>{result.fileName}</h3>
        <p>{result.snippet || '未提供命中片段'}</p>
      </div>
      <div className="search-result__meta">
        <span>{result.sourceLabel}</span>
        <span aria-label={`匹配度 ${(result.score * 100).toFixed(0)}%`}>
          匹配度 {(result.score * 100).toFixed(0)}%
        </span>
        <Button
          aria-label={`打开文件 ${result.fileName}`}
          onClick={() => onOpenFile(result.fileId)}
          variant="link"
        >
          打开文件
        </Button>
      </div>
    </article>
  );
}
