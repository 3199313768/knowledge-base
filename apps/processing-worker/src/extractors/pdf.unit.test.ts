import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { ValidatedFile } from '../validation/fileValidation';
import { extractPdf } from './pdf';
import { createExtractorRegistry, type Extractor } from './registry';

const fixtureDirectory = resolve(
  import.meta.dirname,
  '../../../../fixtures/processing/files'
);

async function pdfFixture(name: string): Promise<ValidatedFile> {
  const filePath = join(fixtureDirectory, name);
  const sizeBytes = (await stat(filePath)).size;
  return {
    filePath,
    declaredMime: 'application/pdf',
    expectedSizeBytes: sizeBytes,
    kind: 'pdf',
    sizeBytes
  };
}

describe('extractPdf', () => {
  it('preserves page locations and never emits an empty page', async () => {
    const result = await extractPdf(await pdfFixture('native-text.pdf'), AbortSignal.timeout(5_000));

    expect(result.blocks.map((block) => block.location)).toEqual([
      expect.objectContaining({ kind: 'page', page: 1, label: '第 1 页' }),
      expect.objectContaining({ kind: 'page', page: 3, label: '第 3 页' })
    ]);
    expect(result.blocks.every((block) => block.text.trim().length > 0)).toBe(true);
    expect(result.blocks.map((block) => block.index)).toEqual([1, 2]);
    expect(result.warnings).toEqual([]);
  });

  it('maps password protection and all-empty pages to stable errors', async () => {
    await expect(
      extractPdf(await pdfFixture('encrypted.pdf'), AbortSignal.timeout(5_000))
    ).rejects.toMatchObject({ code: 'encrypted_file', retryable: false });
    await expect(
      extractPdf(await pdfFixture('empty.pdf'), AbortSignal.timeout(5_000))
    ).rejects.toMatchObject({ code: 'ocr_required', retryable: false });
  });

  it('maps malformed PDF bytes to a stable safe error', async () => {
    await expect(
      extractPdf(await pdfFixture('corrupt.pdf'), AbortSignal.timeout(5_000))
    ).rejects.toMatchObject({ code: 'corrupt_file', retryable: false });
  });

  it('groups text on the same page into paragraphs using vertical gaps', async () => {
    const result = await extractPdf(await pdfFixture('native-text.pdf'), AbortSignal.timeout(5_000));

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]?.type).toBe('paragraph');
    expect(result.blocks[0]?.text).toContain('Phase 2 processing fixture');
    expect(result.blocks[0]?.text).toContain('处理管线样例');
  });

  it('rejects an already aborted signal with a retryable timeout', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(extractPdf(await pdfFixture('native-text.pdf'), controller.signal)).rejects.toMatchObject({
      code: 'worker_timeout',
      retryable: true
    });
  });

  it('keeps reliable pages and emits a structured warning when one page fails', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: async (page: number) => {
            if (page === 2) throw new Error('synthetic page read failure');
            return {
              getTextContent: async () => ({
                items: [
                  {
                    str: 'Reliable first page',
                    transform: [1, 0, 0, 1, 72, 700],
                    height: 12
                  }
                ]
              })
            };
          }
        }),
        destroy: async () => undefined
      })
    }));

    try {
      const { extractPdf: extractWithPageFailure } = await import('./pdf');
      const result = await extractWithPageFailure(
        await pdfFixture('native-text.pdf'),
        AbortSignal.timeout(5_000)
      );

      expect(result.blocks).toMatchObject([
        { index: 1, text: 'Reliable first page', location: { page: 1, label: '第 1 页' } }
      ]);
      expect(result.warnings).toEqual([
        {
          code: 'corrupt_file',
          message: 'Text could not be extracted from this page.',
          sourceLocation: { schemaVersion: 1, kind: 'page', page: 2, label: '第 2 页' }
        }
      ]);
    } finally {
      vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
      vi.resetModules();
    }
  });

  it('maps an all-page FormatError to corrupt_file instead of ocr_required', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => {
            const error = new Error('raw parser details must stay private');
            error.name = 'FormatError';
            throw error;
          }
        }),
        destroy: async () => undefined
      })
    }));

    try {
      const { extractPdf: extractWithFormatError } = await import('./pdf');
      const error = await extractWithFormatError(
        await pdfFixture('native-text.pdf'),
        AbortSignal.timeout(5_000)
      ).catch((failure: unknown) => failure);

      expect(error).toMatchObject({ code: 'corrupt_file', retryable: false });
      expect((error as Error).message).not.toContain('raw parser details');
    } finally {
      vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
      vi.resetModules();
    }
  });
});

describe('createExtractorRegistry', () => {
  const pdfExtractor: Extractor = {
    kind: 'pdf',
    extract: async () => ({ blocks: [], warnings: [] })
  };
  const docxExtractor: Extractor = {
    kind: 'docx',
    extract: async () => ({ blocks: [], warnings: [] })
  };

  it('registers adapters by kind', () => {
    const registry = createExtractorRegistry([pdfExtractor, docxExtractor]);
    expect(registry.get('pdf')).toBe(pdfExtractor);
    expect(registry.get('docx')).toBe(docxExtractor);
  });

  it('rejects duplicate adapter registrations', () => {
    expect(() => createExtractorRegistry([pdfExtractor, pdfExtractor])).toThrow(
      'Duplicate extractor registration for pdf.'
    );
  });
});
