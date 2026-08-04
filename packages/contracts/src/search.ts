export type SourceLocationKind =
  | 'page'
  | 'slide'
  | 'sheet'
  | 'image'
  | 'web'
  | 'text';

export interface SourceLocation {
  kind: SourceLocationKind;
  label: string;
  url?: string;
}

export interface SearchDocument {
  fileId: string;
  workspaceId: string;
  fileName: string;
  sourceType: string;
}

export interface SearchChunk {
  id: string;
  document: SearchDocument;
  content: string;
  sourceLocation: SourceLocation;
}

export interface SearchQuery {
  workspaceId: string;
  text: string;
  limit: number;
}

export interface SearchResult {
  fileId: string;
  fileName: string;
  score: number;
  snippet: string;
  sourceLocation: SourceLocation;
}

export interface EmbeddingProvider {
  readonly dimensions: 384;
  embedPassages(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export function assertSearchResult(value: SearchResult): void {
  if (!value.sourceLocation.label.trim()) {
    throw new Error('sourceLocation.label must not be empty');
  }
}
