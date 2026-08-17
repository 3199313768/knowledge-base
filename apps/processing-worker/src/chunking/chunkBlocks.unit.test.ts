import type { NormalizedBlock, ProcessingSourceLocation } from '@knowledge-base/contracts';
import { describe, expect, it } from 'vitest';

import { chunkBlocks, type ChunkingConfig } from './chunkBlocks';

const pageLocation = (page: number): ProcessingSourceLocation => ({
  schemaVersion: 1,
  kind: 'page',
  page,
  label: `第 ${page} 页`
});

describe('chunkBlocks', () => {
  it('uses the versioned defaults deterministically without crossing source blocks', () => {
    const uninterrupted = Array.from({ length: 1_300 }, (_, index) =>
      String.fromCharCode(97 + (index % 26))
    ).join('');
    const blocks: NormalizedBlock[] = [
      { index: 1, type: 'paragraph', text: uninterrupted, location: pageLocation(1) },
      {
        index: 2,
        type: 'paragraph',
        text: '  Reliable\tsecond   page.  ',
        location: pageLocation(2)
      }
    ];

    const first = chunkBlocks(blocks);
    const second = chunkBlocks(structuredClone(blocks));

    expect(second).toEqual(first);
    expect(first.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
    expect(first.map((chunk) => chunk.content.length)).toEqual([1_200, 220, 21]);
    expect(first[1]?.content.slice(0, 120)).toBe(first[0]?.content.slice(-120));
    expect(first.map((chunk) => chunk.sourceLocation)).toEqual([
      pageLocation(1),
      pageLocation(1),
      pageLocation(2)
    ]);
    expect(first[2]?.content).toBe('Reliable second page.');
  });

  it('prefers sentence boundaries and keeps overlap inside the same paragraph block', () => {
    const location: ProcessingSourceLocation = {
      schemaVersion: 1,
      kind: 'document',
      blockType: 'paragraph',
      blockStart: 4,
      blockEnd: 4,
      headingPath: ['Overview'],
      label: 'Paragraph 4'
    };

    const chunks = chunkBlocks(
      [
        {
          index: 1,
          type: 'paragraph',
          text: 'First sentence. Second sentence. Third sentence.',
          location
        },
        {
          index: 2,
          type: 'paragraph',
          text: 'Unrelated paragraph.',
          location: { ...location, blockStart: 5, blockEnd: 5, label: 'Paragraph 5' }
        }
      ],
      { version: 'phase2-v1', maxCharacters: 32, overlapCharacters: 8 }
    );

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      'First sentence. Second sentence.',
      'entence. Third sentence.',
      'Unrelated paragraph.'
    ]);
    expect(chunks.map((chunk) => chunk.sourceLocation.label)).toEqual([
      'Paragraph 4',
      'Paragraph 4',
      'Paragraph 5'
    ]);
  });

  it('narrows table row ranges to the rows included in each chunk', () => {
    const chunks = chunkBlocks(
      [
        {
          index: 1,
          type: 'table',
          text: 'Header\nRow\tone\nRow   two\nRow three',
          location: {
            schemaVersion: 1,
            kind: 'document',
            blockType: 'table',
            blockStart: 7,
            blockEnd: 7,
            tableIndex: 2,
            rowStart: 10,
            rowEnd: 13,
            label: 'Table 2'
          }
        }
      ],
      { version: 'phase2-v1', maxCharacters: 14, overlapCharacters: 0 }
    );

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      'Header\nRow one',
      'Row two',
      'Row three'
    ]);
    expect(
      chunks.map((chunk) => {
        const location = chunk.sourceLocation;
        return location.kind === 'document'
          ? [location.rowStart, location.rowEnd]
          : undefined;
      })
    ).toEqual([
      [10, 11],
      [12, 12],
      [13, 13]
    ]);
  });

  it('uses a bounded fallback for a table row while retaining that row location', () => {
    const chunks = chunkBlocks(
      [
        {
          index: 1,
          type: 'table',
          text: 'abcdefghijklmnopqrstuvwxy',
          location: {
            schemaVersion: 1,
            kind: 'document',
            blockType: 'table',
            blockStart: 2,
            blockEnd: 2,
            tableIndex: 1,
            rowStart: 5,
            rowEnd: 5,
            label: 'Table 1'
          }
        }
      ],
      { version: 'phase2-v1', maxCharacters: 10, overlapCharacters: 0 }
    );

    expect(chunks.map((chunk) => chunk.content)).toEqual([
      'abcdefghij',
      'klmnopqrst',
      'uvwxy'
    ]);
    expect(
      chunks.every(
        (chunk) =>
          chunk.sourceLocation.kind === 'document' &&
          chunk.sourceLocation.rowStart === 5 &&
          chunk.sourceLocation.rowEnd === 5
      )
    ).toBe(true);
  });

  it('rejects a table whose text cannot be mapped to its declared row range', () => {
    expect(() =>
      chunkBlocks(
        [
          {
            index: 1,
            type: 'table',
            text: 'First line\nSecond line\nThird line',
            location: {
              schemaVersion: 1,
              kind: 'document',
              blockType: 'table',
              blockStart: 2,
              blockEnd: 2,
              tableIndex: 1,
              rowStart: 5,
              rowEnd: 6,
              label: 'Table 1'
            }
          }
        ],
        { version: 'phase2-v1', maxCharacters: 10, overlapCharacters: 0 }
      )
    ).toThrow('row range');
  });

  it('keeps bounded chunks from a multiline cell within its single declared row', () => {
    const chunks = chunkBlocks(
      [
        {
          index: 1,
          type: 'table',
          text: 'Outer before\nNested\nOuter after',
          location: {
            schemaVersion: 1,
            kind: 'document',
            blockType: 'table',
            blockStart: 2,
            blockEnd: 2,
            tableIndex: 1,
            rowStart: 5,
            rowEnd: 5,
            label: 'Table 1'
          }
        }
      ],
      { version: 'phase2-v1', maxCharacters: 12, overlapCharacters: 0 }
    );

    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.content === chunk.content.trim())).toBe(true);
    expect(
      chunks.every(
        (chunk) =>
          chunk.sourceLocation.kind === 'document' &&
          chunk.sourceLocation.rowStart === 5 &&
          chunk.sourceLocation.rowEnd === 5
      )
    ).toBe(true);
  });

  it('removes empty outputs before assigning zero-based contiguous indices', () => {
    const chunks = chunkBlocks([
      { index: 1, type: 'paragraph', text: ' \n\t ', location: pageLocation(1) },
      { index: 2, type: 'paragraph', text: 'Kept.', location: pageLocation(2) }
    ]);

    expect(chunks).toEqual([
      { index: 0, content: 'Kept.', sourceLocation: pageLocation(2) }
    ]);
  });

  it('rejects unsupported or non-progressing chunk configurations', () => {
    const blocks: NormalizedBlock[] = [
      { index: 1, type: 'paragraph', text: 'Content.', location: pageLocation(1) }
    ];

    expect(() =>
      chunkBlocks(blocks, {
        version: 'phase2-v2' as 'phase2-v1',
        maxCharacters: 1_200,
        overlapCharacters: 120
      })
    ).toThrow('phase2-v1');
    expect(() =>
      chunkBlocks(blocks, {
        version: 'phase2-v1',
        maxCharacters: 120,
        overlapCharacters: 120
      })
    ).toThrow('overlapCharacters');
  });

  it('rejects unknown runtime config keys instead of ignoring them', () => {
    const blocks: NormalizedBlock[] = [
      { index: 1, type: 'paragraph', text: 'Content.', location: pageLocation(1) }
    ];
    const mistakenConfig = {
      configVersion: 'phase2-v2'
    } as unknown as Partial<ChunkingConfig>;

    expect(() => chunkBlocks(blocks, mistakenConfig)).toThrow('configVersion');
  });
});
