import { describe, expect, it } from 'vitest';
import {
  assertChunkDraft,
  assertNormalizedBlock,
  assertProcessingSourceLocation
} from './processing';

describe('assertProcessingSourceLocation', () => {
  it('accepts a one-based PDF page', () => {
    expect(() =>
      assertProcessingSourceLocation({
        schemaVersion: 1,
        kind: 'page',
        page: 3,
        label: '第 3 页'
      })
    ).not.toThrow();
  });

  it('rejects a zero page and inconsistent document rows', () => {
    expect(() =>
      assertProcessingSourceLocation({
        schemaVersion: 1,
        kind: 'page',
        page: 0,
        label: '第 0 页'
      })
    ).toThrow('page must be a positive integer');
    expect(() =>
      assertProcessingSourceLocation({
        schemaVersion: 1,
        kind: 'document',
        blockType: 'table',
        blockStart: 2,
        blockEnd: 2,
        tableIndex: 1,
        rowStart: 4,
        rowEnd: 2,
        label: '表格 1'
      })
    ).toThrow('row range');
  });

  it('rejects table-only fields on a page location', () => {
    expect(() =>
      assertProcessingSourceLocation({
        schemaVersion: 1,
        kind: 'page',
        page: 3,
        tableIndex: 1,
        label: '第 3 页'
      })
    ).toThrow('table fields');
  });
});

describe('processing record validators', () => {
  const pageLocation = {
    schemaVersion: 1,
    kind: 'page',
    page: 1,
    label: '第 1 页'
  } as const;

  it.each([-1, 0.5, Number.NaN])(
    'rejects invalid normalized block index %s',
    (index) => {
      expect(() =>
        assertNormalizedBlock({
          index,
          type: 'paragraph',
          text: '正文',
          location: pageLocation
        })
      ).toThrow('index must be a non-negative integer');
    }
  );

  it.each([-1, 0.5, Number.NaN])(
    'rejects invalid chunk draft index %s',
    (index) => {
      expect(() =>
        assertChunkDraft({
          index,
          content: '正文',
          sourceLocation: pageLocation
        })
      ).toThrow('index must be a non-negative integer');
    }
  );

  it('validates each embedded source location', () => {
    expect(() =>
      assertNormalizedBlock({
        index: 0,
        type: 'paragraph',
        text: '正文',
        location: { schemaVersion: 1, kind: 'page', page: 0, label: '第 0 页' }
      })
    ).toThrow('page must be a positive integer');
    expect(() =>
      assertChunkDraft({
        index: 0,
        content: '正文',
        sourceLocation: { schemaVersion: 1, kind: 'page', page: 0, label: '第 0 页' }
      })
    ).toThrow('page must be a positive integer');
  });
});
