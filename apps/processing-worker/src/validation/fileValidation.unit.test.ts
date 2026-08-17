import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  generateFixtures,
  verifyFixtureCorpus,
  type FixtureManifest
} from '../../../../fixtures/processing/generate';
import {
  detectFileKind,
  validateOriginalFile,
  type OriginalFileDescriptor
} from './fileValidation';

const fixtureDirectory = resolve(
  import.meta.dirname,
  '../../../../fixtures/processing/files'
);
const manifestPath = resolve(
  import.meta.dirname,
  '../../../../fixtures/processing/manifest.json'
);
const corpusDirectory = resolve(import.meta.dirname, '../../../../fixtures/processing');
const docxMime =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function fixtureDescriptor(
  name: string,
  declaredMime: string
): Promise<OriginalFileDescriptor> {
  const filePath = join(fixtureDirectory, name);
  return {
    filePath,
    declaredMime,
    expectedSizeBytes: (await stat(filePath)).size
  };
}

describe('validateOriginalFile', () => {
  it.each([
    ['native-text.pdf', 'application/pdf', 'pdf'],
    ['paragraphs-and-table.docx', docxMime, 'docx']
  ])('validates %s by bytes, not extension', async (name, mime, kind) => {
    await expect(validateOriginalFile(await fixtureDescriptor(name, mime))).resolves.toMatchObject({
      kind,
      sizeBytes: expect.any(Number)
    });
  });

  it('rejects declared PDF containing DOCX bytes', async () => {
    await expect(
      validateOriginalFile(await fixtureDescriptor('paragraphs-and-table.docx', 'application/pdf'))
    ).rejects.toMatchObject({ code: 'mime_mismatch', retryable: false });
  });

  it('rejects PDF bytes declared as DOCX even when the extension is misleading', async () => {
    await expect(
      validateOriginalFile(await fixtureDescriptor('pdf-named-as-docx.docx', docxMime))
    ).rejects.toMatchObject({ code: 'mime_mismatch', retryable: false });
  });

  it.each([
    ['empty.pdf', 'application/pdf', 'empty_content'],
    ['corrupt.pdf', 'application/pdf', 'corrupt_file'],
    ['corrupt.docx', docxMime, 'corrupt_file'],
    ['oversized-entry.docx', docxMime, 'unsafe_archive']
  ])('rejects %s with a stable safe error', async (name, mime, code) => {
    await expect(validateOriginalFile(await fixtureDescriptor(name, mime))).rejects.toMatchObject({
      code,
      retryable: false
    });
  });

  it('rejects recorded-size mismatches without exposing the file path', async () => {
    const descriptor = await fixtureDescriptor('native-text.pdf', 'application/pdf');
    const error = await validateOriginalFile({
      ...descriptor,
      expectedSizeBytes: descriptor.expectedSizeBytes + 1
    }).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: 'corrupt_file', retryable: false });
    expect((error as Error).message).not.toContain(basename(descriptor.filePath));
  });

  it('identifies only known file signatures', () => {
    expect(detectFileKind(Buffer.from('%PDF-1.7'))).toBe('pdf');
    expect(detectFileKind(Buffer.from('PK\u0003\u0004'))).toBe('docx');
    expect(detectFileKind(Buffer.from('not a document'))).toBeUndefined();
    expect(detectFileKind(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('processing fixture generator', () => {
  it('rejects generation when the pinned native font hash is wrong', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'processing-fixture-font-hash-'));
    temporaryDirectories.push(destination);

    await expect(
      generateFixtures(destination, { nativeTextFontSha256: '0'.repeat(64) })
    ).rejects.toThrow('Pinned native-text font verification failed.');
  });

  it('verifies committed fixture bytes and rejects a same-size tampered copy', async () => {
    const committed = JSON.parse(await readFile(manifestPath, 'utf8')) as FixtureManifest;
    await expect(verifyFixtureCorpus(corpusDirectory, committed)).resolves.toBeUndefined();

    const destination = await mkdtemp(join(tmpdir(), 'processing-fixture-tamper-'));
    temporaryDirectories.push(destination);
    await cp(corpusDirectory, destination, { recursive: true });
    const target = join(destination, 'files', 'native-text.pdf');
    const bytes = Buffer.from(await readFile(target));
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0x01;
    await writeFile(target, bytes);

    await expect(verifyFixtureCorpus(destination, committed)).rejects.toThrow(
      'Fixture corpus verification failed.'
    );
  });

  it('rejects an unmanifested file added to an otherwise valid corpus copy', async () => {
    const committed = JSON.parse(await readFile(manifestPath, 'utf8')) as FixtureManifest;
    const destination = await mkdtemp(join(tmpdir(), 'processing-fixture-extra-'));
    temporaryDirectories.push(destination);
    await cp(corpusDirectory, destination, { recursive: true });
    await writeFile(join(destination, 'files', 'not-in-manifest.txt'), 'synthetic extra');

    await expect(verifyFixtureCorpus(destination, committed)).rejects.toThrow(
      'Fixture corpus verification failed.'
    );
  });

  it('regenerates the versioned corpus with matching byte checksums', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'processing-fixtures-'));
    temporaryDirectories.push(destination);

    const generated = await generateFixtures(destination);
    const committed = JSON.parse(await readFile(manifestPath, 'utf8')) as FixtureManifest;

    expect(generated).toEqual(committed);
    await Promise.all(
      committed.files.map(async (fixture) => {
        const bytes = await readFile(join(destination, 'files', fixture.filename));
        expect(bytes.byteLength).toBe(fixture.byteSize);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
      })
    );
  });

  it('extracts the intended bilingual phrases from native-text.pdf with PDF.js', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await readFile(join(fixtureDirectory, 'native-text.pdf')))
    });
    const document = await loadingTask.promise;
    const firstPage = await document.getPage(1);
    const pages = await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const content = await (await document.getPage(index + 1)).getTextContent();
        return content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join('');
      })
    );
    expect(pages[0]).toContain('Phase 2 processing fixture');
    expect(pages[0]).toContain('处理管线样例');
    expect(pages[1]).toBe('');
    expect(pages[2]).toContain('第三页：安全、可复现、可验证。');

    const operators = await firstPage.getOperatorList();
    const setFontIndex = operators.fnArray.findIndex(
      (operator) => operator === pdfjs.OPS.setFont
    );
    expect(setFontIndex).toBeGreaterThanOrEqual(0);
    const fontName = operators.argsArray[setFontIndex]?.[0];
    const font = (
      firstPage as unknown as {
        commonObjs: {
          get(name: string): { attached?: boolean; mimetype?: string; missingFile?: boolean };
        };
      }
    ).commonObjs.get(String(fontName));
    expect(font.missingFile).toBe(false);
    expect(font.attached).toBe(true);
    expect(font.mimetype).toBe('font/opentype');
    await loadingTask.destroy();
  });
});
