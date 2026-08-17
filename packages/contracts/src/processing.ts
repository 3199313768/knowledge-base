export type ProcessingSourceLocation =
  | {
      schemaVersion: 1;
      kind: 'page';
      page: number;
      label: string;
    }
  | {
      schemaVersion: 1;
      kind: 'document';
      blockType: 'paragraph' | 'table';
      blockStart: number;
      blockEnd: number;
      headingPath?: string[];
      tableIndex?: number;
      rowStart?: number;
      rowEnd?: number;
      label: string;
    };

export interface NormalizedBlock {
  index: number;
  type: 'paragraph' | 'table';
  text: string;
  location: ProcessingSourceLocation;
}

export interface ChunkDraft {
  index: number;
  content: string;
  sourceLocation: ProcessingSourceLocation;
}

export type PermanentProcessingErrorCode =
  | 'unsupported_type'
  | 'mime_mismatch'
  | 'encrypted_file'
  | 'corrupt_file'
  | 'empty_content'
  | 'ocr_required'
  | 'unsafe_archive';

export type TransientProcessingErrorCode =
  | 'storage_download_failed'
  | 'artifact_io_failed'
  | 'model_load_failed'
  | 'embedding_failed'
  | 'database_write_failed'
  | 'worker_timeout';

export type ProcessingErrorCode =
  | PermanentProcessingErrorCode
  | TransientProcessingErrorCode;

export interface ProcessingWarning {
  code: ProcessingErrorCode;
  message: string;
  sourceLocation?: ProcessingSourceLocation;
}

export function assertNormalizedBlock(
  value: unknown
): asserts value is NormalizedBlock {
  if (!isRecord(value)) {
    throw new Error('normalized block must be an object');
  }
  assertNonNegativeInteger(value.index, 'index');
  if (value.type !== 'paragraph' && value.type !== 'table') {
    throw new Error('type must be paragraph or table');
  }
  if (typeof value.text !== 'string') {
    throw new Error('text must be a string');
  }
  assertProcessingSourceLocation(value.location);
}

export function assertChunkDraft(value: unknown): asserts value is ChunkDraft {
  if (!isRecord(value)) {
    throw new Error('chunk draft must be an object');
  }
  assertNonNegativeInteger(value.index, 'index');
  if (typeof value.content !== 'string') {
    throw new Error('content must be a string');
  }
  assertProcessingSourceLocation(value.sourceLocation);
}

export function assertProcessingSourceLocation(
  value: unknown
): asserts value is ProcessingSourceLocation {
  if (!isRecord(value)) {
    throw new Error('source location must be an object');
  }
  if (value.schemaVersion !== 1) {
    throw new Error('schemaVersion must be 1');
  }
  if (typeof value.label !== 'string' || !value.label.trim()) {
    throw new Error('label must not be empty');
  }

  if (value.kind === 'page') {
    assertPositiveInteger(value.page, 'page');
    if (
      value.tableIndex !== undefined ||
      value.rowStart !== undefined ||
      value.rowEnd !== undefined
    ) {
      throw new Error('table fields are only valid for table blocks');
    }
    return;
  }
  if (value.kind !== 'document') {
    throw new Error('kind must be page or document');
  }
  if (value.blockType !== 'paragraph' && value.blockType !== 'table') {
    throw new Error('blockType must be paragraph or table');
  }

  assertOrderedRange(value.blockStart, value.blockEnd, 'block range');

  if (value.blockType === 'paragraph') {
    if (
      value.tableIndex !== undefined ||
      value.rowStart !== undefined ||
      value.rowEnd !== undefined
    ) {
      throw new Error('table fields are only valid for table blocks');
    }
    return;
  }

  assertPositiveInteger(value.tableIndex, 'tableIndex');
  assertOrderedRange(value.rowStart, value.rowEnd, 'row range');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertPositiveInteger(
  value: unknown,
  field: string
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function assertNonNegativeInteger(
  value: unknown,
  field: string
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function assertOrderedRange(
  start: unknown,
  end: unknown,
  field: string
): void {
  assertPositiveInteger(start, `${field} start`);
  assertPositiveInteger(end, `${field} end`);
  if (start > end) {
    throw new Error(`${field} must be ordered`);
  }
}
