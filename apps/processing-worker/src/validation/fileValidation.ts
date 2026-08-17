import { open, stat } from 'node:fs/promises';

import yauzl from 'yauzl';

import { ProcessingFailure } from '../core/errors';

const maxFileBytes = 100_000_000;
const maxArchiveEntryBytes = 50_000_000;
const pdfMime = 'application/pdf';
const docxMime =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const requiredDocxEntries = new Set([
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml'
]);

export interface OriginalFileDescriptor {
  filePath: string;
  declaredMime: string;
  expectedSizeBytes: number;
}

export interface ValidatedFile extends OriginalFileDescriptor {
  kind: 'pdf' | 'docx';
  sizeBytes: number;
}

export function detectFileKind(header: Uint8Array): 'pdf' | 'docx' | undefined {
  if (
    header.length >= 5 &&
    header.subarray(0, 5).every((byte, index) => byte === Buffer.from('%PDF-')[index])
  ) {
    return 'pdf';
  }
  if (
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    header[2] === 0x03 &&
    header[3] === 0x04
  ) {
    return 'docx';
  }
  return undefined;
}

export async function validateOriginalFile(
  input: OriginalFileDescriptor
): Promise<ValidatedFile> {
  const declaredKind = kindForDeclaredMime(input.declaredMime);
  if (!declaredKind) {
    throw failure('unsupported_type');
  }

  const sizeBytes = await actualSize(input.filePath);
  if (sizeBytes === 0) {
    throw failure('empty_content');
  }
  if (sizeBytes > maxFileBytes) {
    throw failure('unsafe_archive');
  }
  if (sizeBytes !== input.expectedSizeBytes) {
    throw failure('corrupt_file');
  }

  const kind = detectFileKind(await readHeader(input.filePath));
  if (!kind) {
    throw failure('corrupt_file');
  }
  if (kind !== declaredKind) {
    throw failure('mime_mismatch');
  }
  if (kind === 'docx') {
    await validateDocxArchive(input.filePath);
  }
  return { ...input, kind, sizeBytes };
}

async function actualSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    throw failure('artifact_io_failed');
  }
}

async function readHeader(filePath: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(filePath, 'r');
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
    return header.subarray(0, bytesRead);
  } catch {
    throw failure('artifact_io_failed');
  } finally {
    await handle?.close();
  }
}

async function validateDocxArchive(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(failure('corrupt_file'));
        return;
      }

      const foundEntries = new Set<string>();
      let settled = false;
      const rejectSafely = (code: 'corrupt_file' | 'unsafe_archive') => {
        if (!settled) {
          settled = true;
          zip.close();
          reject(failure(code));
        }
      };
      zip.on('error', () => rejectSafely('corrupt_file'));
      zip.on('entry', (entry) => {
        if (entry.uncompressedSize > maxArchiveEntryBytes) {
          rejectSafely('unsafe_archive');
          return;
        }
        if (requiredDocxEntries.has(entry.fileName)) {
          foundEntries.add(entry.fileName);
        }
        zip.readEntry();
      });
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        if (requiredDocxEntries.size !== foundEntries.size) {
          reject(failure('corrupt_file'));
          return;
        }
        resolve();
      });
      zip.readEntry();
    });
  });
}

function kindForDeclaredMime(mime: string): 'pdf' | 'docx' | undefined {
  if (mime === pdfMime) return 'pdf';
  if (mime === docxMime) return 'docx';
  return undefined;
}

function failure(
  code: 'unsupported_type' | 'mime_mismatch' | 'corrupt_file' | 'empty_content' | 'unsafe_archive' | 'artifact_io_failed'
): ProcessingFailure {
  const messages = {
    unsupported_type: 'The file type is not supported.',
    mime_mismatch: 'The declared file type does not match the file content.',
    corrupt_file: 'The file could not be validated.',
    empty_content: 'The file is empty.',
    unsafe_archive: 'The file exceeds the permitted safety limits.',
    artifact_io_failed: 'The file could not be read.'
  } as const;
  return new ProcessingFailure(code, messages[code], code === 'artifact_io_failed');
}
