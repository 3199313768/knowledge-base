import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';

import type { NormalizedBlock, ProcessingWarning } from '@knowledge-base/contracts';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

import { ProcessingFailure } from '../core/errors';
import type { ValidatedFile } from '../validation/fileValidation';
import type { ExtractionResult } from './registry';

const maxArchiveEntries = 10_000;
const maxArchiveEntryBytes = 50_000_000;
const maxArchiveExpandedBytes = 500_000_000;
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const contentTypesPart = '[Content_Types].xml';
const documentPart = 'word/document.xml';
const stylesPart = 'word/styles.xml';

export interface ArchiveEntryMetadata {
  fileName: string;
  uncompressedSize: number;
}

interface OpenArchive {
  zip: ZipFile;
  entries: Map<string, Entry>;
}

interface ParagraphState {
  target: 'body' | 'cell' | 'ignored';
  sourceBlock: number | undefined;
  styleId: string | undefined;
  text: string[];
}

interface TableState {
  sourceBlock: number;
  rows: string[][];
}

export function assertSafeArchiveEntry(entry: ArchiveEntryMetadata): void {
  const segments = entry.fileName.split('/');
  if (
    !entry.fileName ||
    entry.fileName.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(entry.fileName) ||
    entry.fileName.includes('\\') ||
    segments.some((segment) => segment === '..') ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 0 ||
    entry.uncompressedSize > maxArchiveEntryBytes
  ) {
    throw unsafeArchiveFailure();
  }
}

export async function extractDocx(
  file: ValidatedFile,
  signal: AbortSignal
): Promise<ExtractionResult> {
  if (signal.aborted) throw timeoutFailure();

  let archive: OpenArchive | undefined;
  try {
    archive = await openSafeArchive(file.filePath, signal);
    const warnings: ProcessingWarning[] = [];

    await parseXmlPart(archive.zip, archive.entries.get(contentTypesPart)!, signal, {});

    const styleNames = await readStyleNames(archive, signal, warnings);
    const blocks = await parseDocument(
      archive.zip,
      archive.entries.get(documentPart)!,
      styleNames,
      signal
    );
    if (blocks.length === 0) throw emptyContentFailure();
    return { blocks, warnings };
  } catch (error) {
    if (signal.aborted || isAbort(error)) throw timeoutFailure();
    if (error instanceof ProcessingFailure) throw error;
    throw corruptFileFailure();
  } finally {
    archive?.zip.close();
  }
}

async function openSafeArchive(filePath: string, signal: AbortSignal): Promise<OpenArchive> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { autoClose: false, lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(corruptFileFailure());
        return;
      }

      const entries = new Map<string, Entry>();
      let archiveEntryCount = 0;
      let expandedBytes = 0;
      let settled = false;
      const settle = (error?: ProcessingFailure) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (error) {
          zip.close();
          reject(error);
        } else {
          resolve({ zip, entries });
        }
      };
      const onAbort = () => settle(timeoutFailure());

      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      zip.on('error', () => settle(corruptFileFailure()));
      zip.on('entry', (entry: Entry) => {
        if (settled) return;
        try {
          assertSafeArchiveEntry(entry);
          archiveEntryCount += 1;
          expandedBytes += entry.uncompressedSize;
          if (archiveEntryCount > maxArchiveEntries || expandedBytes > maxArchiveExpandedBytes) {
            throw unsafeArchiveFailure();
          }
          if (entry.fileName === contentTypesPart || entry.fileName === documentPart || entry.fileName === stylesPart) {
            entries.set(entry.fileName, entry);
          }
          zip.readEntry();
        } catch (error) {
          settle(error instanceof ProcessingFailure ? error : corruptFileFailure());
        }
      });
      zip.on('end', () => {
        if (!entries.has(contentTypesPart) || !entries.has(documentPart)) {
          settle(corruptFileFailure());
          return;
        }
        settle();
      });
      zip.readEntry();
    });
  });
}

async function readStyleNames(
  archive: OpenArchive,
  signal: AbortSignal,
  warnings: ProcessingWarning[]
): Promise<Map<string, string>> {
  const styles = archive.entries.get(stylesPart);
  if (!styles) return new Map();

  const names = new Map<string, string>();
  let style: { id: string; name: string | undefined } | undefined;
  try {
    await parseXmlPart(archive.zip, styles, signal, {
      onOpenTag(tag) {
        if (isWordTag(tag, 'style')) {
          const id = attribute(tag, 'styleId');
          style = id ? { id, name: undefined } : undefined;
        } else if (style && isWordTag(tag, 'name')) {
          style.name = attribute(tag, 'val');
        }
      },
      onCloseTag(tag) {
        if (isWordTag(tag, 'style') && style) {
          if (style.name) names.set(style.id, style.name);
          style = undefined;
        }
      }
    });
  } catch (error) {
    if (
      signal.aborted ||
      isAbort(error) ||
      (error instanceof ProcessingFailure && error.code === 'worker_timeout')
    ) {
      throw error;
    }
    warnings.push({
      code: 'corrupt_file',
      message: 'Document style metadata could not be read.'
    });
  }
  return names;
}

async function parseDocument(
  zip: ZipFile,
  entry: Entry,
  styleNames: Map<string, string>,
  signal: AbortSignal
): Promise<NormalizedBlock[]> {
  const blocks: NormalizedBlock[] = [];
  let sourceBlock = 0;
  let tableIndex = 0;
  let tableDepth = 0;
  let textDepth = 0;
  const elementStack: Array<{ uri: string | undefined; local: string | undefined }> = [];
  const paragraphs: ParagraphState[] = [];
  let table: TableState | undefined;
  let row: string[] | undefined;
  let cell: string[] | undefined;
  let headingPath: string[] = [];

  await parseXmlPart(zip, entry, signal, {
    onOpenTag(tag) {
      const parent = elementStack.at(-1);
      elementStack.push({ uri: tag.uri, local: tag.local });
      const directBodyChild = parent?.uri === wordNamespace && parent.local === 'body';
      if (isWordTag(tag, 'tbl')) {
        if (directBodyChild) {
          sourceBlock += 1;
          table = { sourceBlock, rows: [] };
          tableDepth = 1;
        } else if (table) {
          tableDepth += 1;
        }
        return;
      }
      if (isWordTag(tag, 'tr') && tableDepth === 1 && table) {
        row = [];
        return;
      }
      if (isWordTag(tag, 'tc') && tableDepth === 1 && row) {
        cell = [];
        return;
      }
      if (isWordTag(tag, 'p')) {
        const target = directBodyChild ? 'body' : table && cell ? 'cell' : 'ignored';
        if (target === 'body') sourceBlock += 1;
        paragraphs.push({
          target,
          sourceBlock: target === 'body' ? sourceBlock : undefined,
          styleId: undefined,
          text: []
        });
        return;
      }
      const paragraph = paragraphs.at(-1);
      if (paragraph && isWordTag(tag, 'pStyle')) {
        paragraph.styleId = attribute(tag, 'val');
        return;
      }
      if (paragraph && isWordTag(tag, 't')) {
        textDepth += 1;
        return;
      }
      if (paragraph && isWordTag(tag, 'tab')) {
        paragraph.text.push('\t');
      } else if (paragraph && isWordTag(tag, 'br')) {
        paragraph.text.push('\n');
      }
    },
    onText(text) {
      const paragraph = paragraphs.at(-1);
      if (paragraph && textDepth > 0) paragraph.text.push(text);
    },
    onCloseTag(tag) {
      if (isWordTag(tag, 't') && textDepth > 0) {
        textDepth -= 1;
        elementStack.pop();
        return;
      }
      if (isWordTag(tag, 'p')) {
        const finished = paragraphs.pop();
        if (!finished) {
          elementStack.pop();
          return;
        }
        const text = finished.text.join('').trim();
        if (finished.target === 'cell') {
          if (text) cell?.push(text);
        } else if (finished.target === 'body' && text) {
          const nextHeadingPath = updateHeadingPath(headingPath, finished.styleId, text, styleNames);
          headingPath = nextHeadingPath;
          blocks.push({
            index: blocks.length + 1,
            type: 'paragraph',
            text,
            location: documentLocation('paragraph', finished.sourceBlock!, {
              headingPath: nextHeadingPath
            })
          });
        }
      }
      if (isWordTag(tag, 'tc') && tableDepth === 1 && cell && row) {
        row.push(cell.join('\n').trim());
        cell = undefined;
        elementStack.pop();
        return;
      }
      if (isWordTag(tag, 'tr') && tableDepth === 1 && row && table) {
        table.rows.push(row);
        row = undefined;
        elementStack.pop();
        return;
      }
      if (isWordTag(tag, 'tbl') && tableDepth > 0) {
        tableDepth -= 1;
        if (tableDepth > 0 || !table) {
          elementStack.pop();
          return;
        }
        const finished = table;
        table = undefined;
        const text = finished.rows.map((values) => values.join('\t')).join('\n').trim();
        if (!text) {
          elementStack.pop();
          return;
        }
        tableIndex += 1;
        blocks.push({
          index: blocks.length + 1,
          type: 'table',
          text,
          location: documentLocation('table', finished.sourceBlock, {
            headingPath,
            tableIndex,
            rowStart: 1,
            rowEnd: finished.rows.length
          })
        });
        elementStack.pop();
        return;
      }
      elementStack.pop();
    }
  });
  return blocks;
}

function updateHeadingPath(
  current: string[],
  styleId: string | undefined,
  text: string,
  styleNames: ReadonlyMap<string, string>
): string[] {
  const level = headingLevel(styleNames.get(styleId ?? '') ?? styleId);
  if (!level) return current;
  const normalizedLevel = Math.min(level, current.length + 1);
  const next = current.slice(0, normalizedLevel - 1);
  next[normalizedLevel - 1] = text;
  return next;
}

function headingLevel(style: string | undefined): number | undefined {
  const match = style?.match(/^heading[ _-]?(\d+)$/i);
  if (!match) return undefined;
  const level = Number(match[1]);
  return Number.isInteger(level) && level > 0 ? level : undefined;
}

function documentLocation(
  blockType: 'paragraph' | 'table',
  sourceBlock: number,
  options: {
    headingPath?: readonly string[];
    tableIndex?: number;
    rowStart?: number;
    rowEnd?: number;
  }
) {
  const headingPath = options.headingPath?.length ? [...options.headingPath] : undefined;
  const label = blockType === 'paragraph' ? `Paragraph ${sourceBlock}` : `Table ${options.tableIndex}`;
  return {
    schemaVersion: 1 as const,
    kind: 'document' as const,
    blockType,
    blockStart: sourceBlock,
    blockEnd: sourceBlock,
    ...(headingPath ? { headingPath } : {}),
    ...(blockType === 'table'
      ? {
          tableIndex: options.tableIndex!,
          rowStart: options.rowStart!,
          rowEnd: options.rowEnd!
        }
      : {}),
    label
  };
}

async function parseXmlPart(
  zip: ZipFile,
  entry: Entry,
  signal: AbortSignal,
  handlers: {
    onOpenTag?: (tag: SaxesTagNS) => void;
    onCloseTag?: (tag: SaxesTagNS) => void;
    onText?: (text: string) => void;
  }
): Promise<void> {
  const stream = await openEntryStream(zip, entry, signal);
  const decoder = new StringDecoder('utf8');
  const parser = new SaxesParser({ xmlns: true });
  let parseError: Error | undefined;
  parser.on('error', (error) => {
    parseError ??= error;
  });
  parser.on('doctype', () => {
    parseError ??= new Error('DOCTYPE declarations are not supported.');
  });
  parser.on('opentag', (tag) => handlers.onOpenTag?.(tag));
  parser.on('closetag', (tag) => handlers.onCloseTag?.(tag));
  parser.on('text', (text) => handlers.onText?.(text));
  const abortStream = () => stream.destroy(abortError());
  signal.addEventListener('abort', abortStream, { once: true });
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      parser.write(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      if (parseError) throw parseError;
    }
    throwIfAborted(signal);
    parser.write(decoder.end());
    parser.close();
    if (parseError) throw parseError;
  } finally {
    signal.removeEventListener('abort', abortStream);
  }
}

async function openEntryStream(zip: ZipFile, entry: Entry, signal: AbortSignal): Promise<Readable> {
  throwIfAborted(signal);
  return new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (signal.aborted) {
        stream?.destroy(abortError());
        reject(timeoutFailure());
        return;
      }
      if (error || !stream) {
        reject(corruptFileFailure());
        return;
      }
      resolve(stream);
    });
  });
}

function isWordTag(tag: SaxesTagNS, local: string): boolean {
  return tag.uri === wordNamespace && tag.local === local;
}

function attribute(tag: SaxesTagNS, local: string): string | undefined {
  return Object.values(tag.attributes).find((value) => value.local === local)?.value;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw timeoutFailure();
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortError(): Error {
  const error = new Error('DOCX extraction was aborted.');
  error.name = 'AbortError';
  return error;
}

function corruptFileFailure(): ProcessingFailure {
  return new ProcessingFailure('corrupt_file', 'The DOCX could not be parsed.', false);
}

function unsafeArchiveFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'unsafe_archive',
    'unsafe_archive: The DOCX archive exceeds permitted safety limits.',
    false
  );
}

function emptyContentFailure(): ProcessingFailure {
  return new ProcessingFailure('empty_content', 'The DOCX does not contain extractable text.', false);
}

function timeoutFailure(): ProcessingFailure {
  return new ProcessingFailure('worker_timeout', 'DOCX extraction timed out.', true);
}
