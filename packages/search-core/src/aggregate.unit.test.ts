import { describe, expect, it } from 'vitest';

import type { SearchChunk } from '@knowledge-base/contracts';
import { aggregateFiles } from './aggregate';

const location = (page: number) => ({
  schemaVersion: 1 as const,
  kind: 'page' as const,
  page,
  label: `第 ${page} 页`
});

function chunk(
  id: string,
  fileId: string,
  score: number,
  content: string,
  page: number,
  fileName = `${fileId}.pdf`,
  updatedAt = '2026-08-10T00:00:00.000Z'
): SearchChunk & { score: number; updatedAt: string } {
  return {
    id,
    document: { fileId, workspaceId: 'workspace-1', fileName, sourceType: 'upload' },
    content,
    sourceLocation: location(page),
    score,
    updatedAt
  };
}

describe('aggregateFiles', () => {
  it('returns one result per file and at most three snippets', () => {
    const result = aggregateFiles([
      chunk('a1', 'a', 0.9, 'top', 1),
      chunk('a2', 'a', 0.8, 'second', 2),
      chunk('a3', 'a', 0.7, 'third', 3),
      chunk('a4', 'a', 0.6, 'fourth', 4),
      chunk('b1', 'b', 0.85, 'other', 1)
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ fileId: 'a', snippet: 'top' });
    expect(result[0]?.snippets).toHaveLength(3);
  });

  it('applies an exact filename boost without letting recency outrank score', () => {
    const result = aggregateFiles([
      chunk('a1', 'a', 0.8, 'body', 1, '报价.pdf', '2026-08-12T00:00:00.000Z'),
      chunk('b1', 'b', 0.81, 'body', 1, '报价方案.pdf', '2026-08-13T00:00:00.000Z')
    ], { queryText: '报价.pdf' });

    expect(result[0]?.fileId).toBe('a');
  });

  it('supports source type and date filters', () => {
    const result = aggregateFiles([
      chunk('a1', 'a', 0.9, 'a', 1, 'a.pdf', '2026-08-10T00:00:00.000Z'),
      { ...chunk('b1', 'b', 0.95, 'b', 1), document: { ...chunk('b1', 'b', 0.95, 'b', 1).document, sourceType: 'web' } }
    ], { sourceTypes: ['upload'], updatedAfter: '2026-08-09T00:00:00.000Z' });

    expect(result.map((item) => item.fileId)).toEqual(['a']);
  });
});
