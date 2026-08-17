import { readFile } from 'node:fs/promises';

import type { NormalizedBlock, ProcessingWarning } from '@knowledge-base/contracts';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { ProcessingFailure } from '../core/errors';
import type { ValidatedFile } from '../validation/fileValidation';
import type { ExtractionResult } from './registry';

const pageLabel = (page: number) => `第 ${page} 页`;
interface PdfTextItem {
  str: string;
  transform: number[];
  height: number;
}

const pageLocation = (page: number) => ({
  schemaVersion: 1 as const,
  kind: 'page' as const,
  page,
  label: pageLabel(page)
});

export async function extractPdf(
  file: ValidatedFile,
  signal: AbortSignal
): Promise<ExtractionResult> {
  if (signal.aborted) throw timeoutFailure();

  let loadingTask: ReturnType<typeof getDocument> | undefined;
  const cancelLoading = () => {
    void loadingTask?.destroy().catch(() => undefined);
  };

  try {
    const data = new Uint8Array(await readFile(file.filePath, { signal }));
    if (data.byteLength === 0) throw ocrFailure();

    loadingTask = getDocument({
      data,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      stopAtErrors: true,
      useWorkerFetch: false,
      useWasm: false,
      isImageDecoderSupported: false,
      isEvalSupported: false
    } as Parameters<typeof getDocument>[0]);
    signal.addEventListener('abort', cancelLoading, { once: true });

    const document = await loadingTask.promise;
    const blocks: NormalizedBlock[] = [];
    const warnings: ProcessingWarning[] = [];
    let firstPageFailure: unknown;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfAborted(signal);
      try {
        const page = await document.getPage(pageNumber);
        const text = textContentToParagraphs((await page.getTextContent()).items);
        for (const paragraph of text) {
          blocks.push({
            index: blocks.length + 1,
            type: 'paragraph',
            text: paragraph,
            location: pageLocation(pageNumber)
          });
        }
      } catch (error) {
        if (isAbort(error) || signal.aborted) throw timeoutFailure();
        firstPageFailure ??= error;
        warnings.push({
          code: 'corrupt_file',
          message: 'Text could not be extracted from this page.',
          sourceLocation: pageLocation(pageNumber)
        });
      }
    }

    if (blocks.length === 0) {
      if (firstPageFailure) throw pdfFailure(firstPageFailure);
      throw ocrFailure();
    }
    return { blocks, warnings };
  } catch (error) {
    if (error instanceof ProcessingFailure) throw error;
    if (isAbort(error) || signal.aborted) throw timeoutFailure();
    throw pdfFailure(error);
  } finally {
    signal.removeEventListener('abort', cancelLoading);
    await loadingTask?.destroy().catch(() => undefined);
  }
}

function textContentToParagraphs(items: unknown[]): string[] {
  const lines: Array<{ y: number; height: number; items: PdfTextItem[] }> = [];
  for (const item of items) {
    if (!isTextItem(item) || !item.str.trim()) continue;
    const y = Number(item.transform[5]);
    const height = Math.abs(Number(item.height)) || 1;
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - y) <= Math.max(previous.height, height) / 2) {
      previous.items.push(item);
    } else {
      lines.push({ y, height, items: [item] });
    }
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  let previousLine: { y: number; height: number } | undefined;
  for (const line of lines) {
    if (previousLine && Math.abs(previousLine.y - line.y) > Math.max(previousLine.height, line.height) * 1.5) {
      addParagraph(paragraphs, current);
      current = [];
    }
    current.push(line.items.map((item) => item.str).join('').trim());
    previousLine = line;
  }
  addParagraph(paragraphs, current);
  return paragraphs;
}

function isTextItem(value: unknown): value is PdfTextItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'str' in value &&
    typeof value.str === 'string' &&
    'transform' in value &&
    Array.isArray(value.transform) &&
    'height' in value &&
    typeof value.height === 'number'
  );
}

function addParagraph(paragraphs: string[], lines: string[]): void {
  const paragraph = lines.filter(Boolean).join('\n').trim();
  if (paragraph) paragraphs.push(paragraph);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw timeoutFailure();
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function pdfFailure(error: unknown): ProcessingFailure {
  if (error instanceof Error && error.name === 'PasswordException') {
    return new ProcessingFailure('encrypted_file', 'The PDF is password protected.', false);
  }
  return new ProcessingFailure('corrupt_file', 'The PDF could not be parsed.', false);
}

function ocrFailure(): ProcessingFailure {
  return new ProcessingFailure('ocr_required', 'The PDF does not contain extractable text.', false);
}

function timeoutFailure(): ProcessingFailure {
  return new ProcessingFailure('worker_timeout', 'PDF extraction timed out.', true);
}
