import type {
  SearchChunk,
  SearchResult,
  SearchSourceLocation
} from '@knowledge-base/contracts';

import { PHASE2_RANKING_V1 } from './rrf';

export interface AggregatableChunk extends SearchChunk {
  score: number;
  updatedAt?: string | Date | null;
}

export interface AggregateFilters {
  fileIds?: readonly string[];
  sourceTypes?: readonly string[];
  updatedAfter?: string | Date;
  updatedBefore?: string | Date;
}

export interface AggregateOptions extends AggregateFilters {
  queryText?: string;
}

export interface SearchSnippet {
  snippet: string;
  sourceLocation: SearchSourceLocation;
  score: number;
}

export function aggregateFiles(
  chunks: readonly AggregatableChunk[],
  options: AggregateOptions = {}
): SearchResult[] {
  const filtered = chunks.filter((chunk) => matchesFilters(chunk, options));
  const grouped = new Map<string, AggregatableChunk[]>();
  for (const chunk of filtered) {
    const fileId = chunk.document.fileId;
    const fileChunks = grouped.get(fileId) ?? [];
    fileChunks.push(chunk);
    grouped.set(fileId, fileChunks);
  }

  return [...grouped.values()]
    .map((fileChunks) => {
      const ranked = [...fileChunks].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
      const snippets = ranked.slice(0, PHASE2_RANKING_V1.maxSnippets).map((chunk) => ({
        snippet: chunk.content,
        sourceLocation: chunk.sourceLocation,
        score: chunk.score
      }));
      const first = ranked[0]!;
      const exactBoost = isExactFilename(first.document.fileName, options.queryText)
        ? PHASE2_RANKING_V1.filenameBoost
        : 0;
      const score = first.score
        + (ranked[1]?.score ?? 0) * PHASE2_RANKING_V1.secondSnippetWeight
        + (ranked[2]?.score ?? 0) * PHASE2_RANKING_V1.thirdSnippetWeight
        + exactBoost;
      return {
        fileId: first.document.fileId,
        fileName: first.document.fileName,
        score,
        snippet: first.content,
        sourceLocation: first.sourceLocation,
        snippets
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDate = latestDate(grouped.get(left.fileId));
      const rightDate = latestDate(grouped.get(right.fileId));
      return rightDate - leftDate || left.fileName.localeCompare(right.fileName) || left.fileId.localeCompare(right.fileId);
    });
}

function matchesFilters(chunk: AggregatableChunk, options: AggregateOptions): boolean {
  if (options.fileIds && !options.fileIds.includes(chunk.document.fileId)) return false;
  if (options.sourceTypes && !options.sourceTypes.includes(chunk.document.sourceType)) return false;
  const date = dateValue(chunk.updatedAt);
  if (options.updatedAfter && date < dateValue(options.updatedAfter)) return false;
  if (options.updatedBefore && date > dateValue(options.updatedBefore)) return false;
  return true;
}

function isExactFilename(fileName: string, queryText?: string): boolean {
  if (!queryText) return false;
  return fileName.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    === queryText.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function dateValue(value: string | Date | null | undefined): number {
  if (value === undefined || value === null) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function latestDate(chunks: readonly AggregatableChunk[] | undefined): number {
  return Math.max(0, ...(chunks ?? []).map((chunk) => dateValue(chunk.updatedAt)));
}
