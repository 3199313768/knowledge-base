import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import yazl from 'yazl';

import type { ValidatedFile } from '../validation/fileValidation';
import { assertSafeArchiveEntry, extractDocx } from './docx';

const fixtureDirectory = resolve(
  import.meta.dirname,
  '../../../../fixtures/processing/files'
);
const docxMime =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function docxFixture(name: string): Promise<ValidatedFile> {
  const filePath = join(fixtureDirectory, name);
  const sizeBytes = (await stat(filePath)).size;
  return {
    filePath,
    declaredMime: docxMime,
    expectedSizeBytes: sizeBytes,
    kind: 'docx',
    sizeBytes
  };
}

describe('extractDocx', () => {
  it('keeps body paragraphs and tables in document order with source positions', async () => {
    const result = await extractDocx(
      await docxFixture('paragraphs-and-table.docx'),
      AbortSignal.timeout(5_000)
    );

    expect(result.blocks).toMatchObject([
      {
        index: 1,
        type: 'paragraph',
        text: 'Processing Fixture Heading',
        location: {
          kind: 'document',
          blockType: 'paragraph',
          blockStart: 1,
          blockEnd: 1,
          headingPath: ['Processing Fixture Heading']
        }
      },
      {
        index: 2,
        type: 'paragraph',
        text: 'First synthetic paragraph.',
        location: {
          kind: 'document',
          blockType: 'paragraph',
          blockStart: 2,
          blockEnd: 2,
          headingPath: ['Processing Fixture Heading']
        }
      },
      {
        index: 3,
        type: 'paragraph',
        text: 'Second synthetic paragraph.',
        location: {
          kind: 'document',
          blockType: 'paragraph',
          blockStart: 3,
          blockEnd: 3
        }
      },
      {
        index: 4,
        type: 'table',
        text: 'Header\nRow one\nRow two',
        location: {
          kind: 'document',
          blockType: 'table',
          blockStart: 4,
          blockEnd: 4,
          tableIndex: 1,
          rowStart: 1,
          rowEnd: 3,
          headingPath: ['Processing Fixture Heading']
        }
      }
    ]);
    expect(result.blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
      'table'
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('maps empty, corrupt, oversized, and cancelled DOCX input to stable errors', async () => {
    await expect(
      extractDocx(await docxFixture('empty.docx'), AbortSignal.timeout(5_000))
    ).rejects.toMatchObject({ code: 'empty_content', retryable: false });
    await expect(
      extractDocx(await docxFixture('corrupt.docx'), AbortSignal.timeout(5_000))
    ).rejects.toMatchObject({ code: 'corrupt_file', retryable: false });
    await expect(
      extractDocx(await docxFixture('oversized-entry.docx'), AbortSignal.timeout(5_000))
    ).rejects.toMatchObject({ code: 'unsafe_archive', retryable: false });

    const controller = new AbortController();
    controller.abort();
    await expect(
      extractDocx(await docxFixture('paragraphs-and-table.docx'), controller.signal)
    ).rejects.toMatchObject({ code: 'worker_timeout', retryable: true });
  });

  it('keeps direct body blocks intact around a text box and flattens nested-table cell text', async () => {
    const result = await extractDocx(
      await syntheticDocx(`
        <w:p>
          <w:r><w:t>Before</w:t></w:r>
          <w:r><w:txbxContent><w:p><w:r><w:t>Text box</w:t></w:r></w:p></w:txbxContent></w:r>
          <w:r><w:t>After</w:t></w:r>
        </w:p>
        <w:tbl><w:tr><w:tc>
          <w:p><w:r><w:t>Outer before</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Nested</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:p><w:r><w:t>Outer after</w:t></w:r></w:p>
        </w:tc></w:tr></w:tbl>
      `),
      AbortSignal.timeout(5_000)
    );

    expect(result.blocks).toMatchObject([
      { index: 1, type: 'paragraph', text: 'BeforeAfter', location: { blockStart: 1 } },
      {
        index: 2,
        type: 'table',
        text: 'Outer before\nNested\nOuter after',
        location: { blockStart: 2, tableIndex: 1, rowStart: 1, rowEnd: 1 }
      }
    ]);
  });

  it('warns when the optional styles part cannot be read but still extracts the body', async () => {
    const result = await extractWithUnreadableStyles();

    expect(result).toMatchObject({
      blocks: [{ type: 'paragraph', text: 'Reliable body text' }],
      warnings: [
        {
          code: 'corrupt_file',
          message: 'Document style metadata could not be read.'
        }
      ]
    });
  });

  it('keeps later direct body blocks positioned after an empty table', async () => {
    const result = await extractDocx(
      await syntheticDocx(`
        <w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>
        <w:p><w:r><w:t>After empty table</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Later table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      `),
      AbortSignal.timeout(5_000)
    );

    expect(result.blocks).toMatchObject([
      { index: 1, type: 'paragraph', text: 'After empty table', location: { blockStart: 2 } },
      {
        index: 2,
        type: 'table',
        text: 'Later table',
        location: { blockStart: 3, tableIndex: 1, rowStart: 1, rowEnd: 1 }
      }
    ]);
  });

  it('maps a stream-open error arriving after cancellation to a retryable timeout', async () => {
    await expect(extractWithAbortedDocumentOpen()).rejects.toMatchObject({
      code: 'worker_timeout',
      retryable: true
    });
  });
});

describe('assertSafeArchiveEntry', () => {
  it.each([
    '../word/document.xml',
    '/word/document.xml',
    'word/../../x',
    'word\\document.xml'
  ])('rejects unsafe archive entry paths: %s', (fileName) => {
    expect(() => assertSafeArchiveEntry({ fileName, uncompressedSize: 1 })).toThrow(
      'unsafe_archive'
    );
  });

  it('rejects an entry beyond the expanded-size cap while permitting an ordinary part', () => {
    expect(() =>
      assertSafeArchiveEntry({ fileName: 'word/document.xml', uncompressedSize: 50_000_001 })
    ).toThrow('unsafe_archive');
    expect(() =>
      assertSafeArchiveEntry({ fileName: 'word/document.xml', uncompressedSize: 1 })
    ).not.toThrow();
  });
});

describe('extractDocx archive-wide safety limits', () => {
  it('rejects an archive with more than 10,000 entries before parsing document XML', async () => {
    await expect(extractWithSyntheticArchive(10_001, 0)).rejects.toMatchObject({
      code: 'unsafe_archive',
      retryable: false
    });
  });

  it('rejects aggregate expanded data above 500 MB even when each entry is permitted', async () => {
    await expect(extractWithSyntheticArchive(11, 50_000_000)).rejects.toMatchObject({
      code: 'unsafe_archive',
      retryable: false
    });
  });
});

async function extractWithSyntheticArchive(entryCount: number, uncompressedSize: number): Promise<unknown> {
  vi.resetModules();
  vi.doMock('yauzl', () => ({
    default: {
      open: (
        _filePath: string,
        _options: unknown,
        callback: (error: Error | null, zip?: SyntheticZip) => void
      ) => callback(null, new SyntheticZip(entryCount, uncompressedSize))
    }
  }));

  try {
    const { extractDocx: extractSyntheticDocx } = await import('./docx');
    return await extractSyntheticDocx(
      {
        filePath: '/synthetic/archive.docx',
        declaredMime: docxMime,
        expectedSizeBytes: 1,
        kind: 'docx',
        sizeBytes: 1
      },
      AbortSignal.timeout(5_000)
    );
  } finally {
    vi.doUnmock('yauzl');
    vi.resetModules();
  }
}

class SyntheticZip extends EventEmitter {
  #index = 0;

  constructor(
    private readonly entryCount: number,
    private readonly uncompressedSize: number
  ) {
    super();
  }

  close(): void {}

  readEntry(): void {
    queueMicrotask(() => {
      if (this.#index < this.entryCount) {
        this.emit('entry', {
          fileName: `word/part-${this.#index++}.xml`,
          uncompressedSize: this.uncompressedSize
        });
      } else {
        this.emit('end');
      }
    });
  }
}

async function syntheticDocx(body: string): Promise<ValidatedFile> {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-base-docx-'));
  temporaryDirectories.push(directory);
  const filePath = join(directory, 'synthetic.docx');
  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const bytes = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.once('error', reject);
  });
  zip.addBuffer(Buffer.from(contentTypesXml), '[Content_Types].xml');
  zip.addBuffer(Buffer.from(wordDocumentXml(body)), 'word/document.xml');
  zip.end();
  await writeFile(filePath, await bytes);
  const sizeBytes = (await stat(filePath)).size;
  return { filePath, declaredMime: docxMime, expectedSizeBytes: sizeBytes, kind: 'docx', sizeBytes };
}

async function extractWithUnreadableStyles(): Promise<Awaited<ReturnType<typeof extractDocx>>> {
  vi.resetModules();
  vi.doMock('yauzl', () => ({
    default: {
      open: (
        _filePath: string,
        _options: unknown,
        callback: (error: Error | null, zip?: UnreadableStylesZip) => void
      ) => callback(null, new UnreadableStylesZip())
    }
  }));

  try {
    const { extractDocx: extractSyntheticDocx } = await import('./docx');
    return await extractSyntheticDocx(
      {
        filePath: '/synthetic/unreadable-styles.docx',
        declaredMime: docxMime,
        expectedSizeBytes: 1,
        kind: 'docx',
        sizeBytes: 1
      },
      AbortSignal.timeout(5_000)
    );
  } finally {
    vi.doUnmock('yauzl');
    vi.resetModules();
  }
}

class UnreadableStylesZip extends EventEmitter {
  #entryIndex = 0;
  readonly #entries = [
    { fileName: '[Content_Types].xml', uncompressedSize: Buffer.byteLength(contentTypesXml) },
    { fileName: 'word/styles.xml', uncompressedSize: 1 },
    { fileName: 'word/document.xml', uncompressedSize: Buffer.byteLength(wordDocumentXml('<w:p><w:r><w:t>Reliable body text</w:t></w:r></w:p>')) }
  ];

  close(): void {}

  readEntry(): void {
    queueMicrotask(() => {
      const entry = this.#entries[this.#entryIndex++];
      if (entry) this.emit('entry', entry);
      else this.emit('end');
    });
  }

  openReadStream(
    entry: { fileName: string },
    callback: (error: Error | null, stream?: Readable) => void
  ): void {
    if (entry.fileName === 'word/styles.xml') {
      callback(new Error('synthetic style stream failure'));
      return;
    }
    const xml =
      entry.fileName === '[Content_Types].xml'
        ? contentTypesXml
        : wordDocumentXml('<w:p><w:r><w:t>Reliable body text</w:t></w:r></w:p>');
    callback(null, Readable.from([Buffer.from(xml)]));
  }
}

async function extractWithAbortedDocumentOpen(): Promise<unknown> {
  const controller = new AbortController();
  vi.resetModules();
  vi.doMock('yauzl', () => ({
    default: {
      open: (
        _filePath: string,
        _options: unknown,
        callback: (error: Error | null, zip?: AbortThenOpenErrorZip) => void
      ) => callback(null, new AbortThenOpenErrorZip(controller))
    }
  }));

  try {
    const { extractDocx: extractSyntheticDocx } = await import('./docx');
    return await extractSyntheticDocx(
      {
        filePath: '/synthetic/aborted-open.docx',
        declaredMime: docxMime,
        expectedSizeBytes: 1,
        kind: 'docx',
        sizeBytes: 1
      },
      controller.signal
    );
  } finally {
    vi.doUnmock('yauzl');
    vi.resetModules();
  }
}

class AbortThenOpenErrorZip extends EventEmitter {
  #entryIndex = 0;
  readonly #entries = [
    { fileName: '[Content_Types].xml', uncompressedSize: Buffer.byteLength(contentTypesXml) },
    { fileName: 'word/document.xml', uncompressedSize: 1 }
  ];

  constructor(private readonly controller: AbortController) {
    super();
  }

  close(): void {}

  readEntry(): void {
    queueMicrotask(() => {
      const entry = this.#entries[this.#entryIndex++];
      if (entry) this.emit('entry', entry);
      else this.emit('end');
    });
  }

  openReadStream(
    entry: { fileName: string },
    callback: (error: Error | null, stream?: Readable) => void
  ): void {
    if (entry.fileName === '[Content_Types].xml') {
      callback(null, Readable.from([Buffer.from(contentTypesXml)]));
      return;
    }
    queueMicrotask(() => {
      this.controller.abort();
      callback(new Error('synthetic document stream-open failure'));
    });
  }
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

function wordDocumentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
}
