import { promisify } from 'node:util';
import {
  crc32,
  gzip as gzipCallback,
  inflateRaw as inflateRawCallback
} from 'node:zlib';

import {
  assertChunkDraft,
  assertNormalizedBlock,
  assertProcessingSourceLocation,
  type ChunkDraft,
  type NormalizedBlock,
  type ProcessingSourceLocation
} from '@knowledge-base/contracts';

export type ArtifactKind = 'normalized' | 'chunks';

export type ArtifactEnvelope =
  | {
      schemaVersion: 1;
      kind: 'normalized';
      configVersion: 'phase2-v1';
      payload: NormalizedBlock[];
    }
  | {
      schemaVersion: 1;
      kind: 'chunks';
      configVersion: 'phase2-v1';
      payload: ChunkDraft[];
    };

const gzip = promisify(gzipCallback);
const maximumDecompressedBytes = 100_000_000;
const envelopeKeys = ['configVersion', 'kind', 'payload', 'schemaVersion'] as const;

interface RawInflateResult {
  buffer: Buffer;
  engine: {
    bytesWritten: number;
  };
}

class SingleGzipMemberError extends Error {}

export async function encodeArtifact(envelope: ArtifactEnvelope): Promise<Uint8Array> {
  assertArtifactEnvelope(envelope);
  const json = canonicalJson(envelope);
  const compressed = await gzip(Buffer.from(json, 'utf8'), { level: 9 });

  compressed[4] = 0;
  compressed[5] = 0;
  compressed[6] = 0;
  compressed[7] = 0;
  compressed[9] = 255;
  return Uint8Array.from(compressed);
}

export async function decodeArtifact<K extends ArtifactKind>(
  bytes: Uint8Array,
  expectedKind: K
): Promise<Extract<ArtifactEnvelope, { kind: K }>> {
  let decompressed: Buffer;
  try {
    decompressed = await decodeSingleGzipMember(bytes);
  } catch (error) {
    if (isOutputLimitError(error)) {
      throw new Error('Artifact decompressed output exceeds the 100 MB limit.');
    }
    if (error instanceof SingleGzipMemberError) throw error;
    throw new Error('Artifact is not valid gzip data.', { cause: error });
  }

  if (decompressed.byteLength > maximumDecompressedBytes) {
    throw new Error('Artifact decompressed output exceeds the 100 MB limit.');
  }

  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error('Artifact does not contain valid UTF-8 JSON.', { cause: error });
  }

  assertArtifactEnvelope(value, expectedKind);
  if (text !== canonicalJson(value)) {
    throw new Error('Artifact JSON must use the canonical JSON representation.');
  }
  return value as Extract<ArtifactEnvelope, { kind: K }>;
}

async function decodeSingleGzipMember(bytes: Uint8Array): Promise<Buffer> {
  const compressed = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    compressed.byteLength < 20 ||
    compressed[0] !== 0x1f ||
    compressed[1] !== 0x8b ||
    compressed[2] !== 0x08 ||
    compressed[3] !== 0
  ) {
    throw singleGzipMemberFailure();
  }

  const trailerOffset = compressed.byteLength - 8;
  const rawPayload = compressed.subarray(10, trailerOffset);
  const inflated = await inflateRawWithInfo(rawPayload);
  if (inflated.engine.bytesWritten !== rawPayload.byteLength) {
    throw new SingleGzipMemberError(
      'Artifact must contain a single gzip member and canonical JSON representation.'
    );
  }

  const expectedCrc = compressed.readUInt32LE(trailerOffset);
  const expectedSize = compressed.readUInt32LE(trailerOffset + 4);
  if (
    (crc32(inflated.buffer) >>> 0) !== expectedCrc ||
    (inflated.buffer.byteLength >>> 0) !== expectedSize
  ) {
    throw singleGzipMemberFailure();
  }
  return inflated.buffer;
}

function inflateRawWithInfo(rawPayload: Buffer): Promise<RawInflateResult> {
  return new Promise((resolve, reject) => {
    inflateRawCallback(
      rawPayload,
      { info: true, maxOutputLength: maximumDecompressedBytes },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result as unknown as RawInflateResult);
      }
    );
  });
}

function singleGzipMemberFailure(): SingleGzipMemberError {
  return new SingleGzipMemberError(
    'Artifact must contain a single gzip member with a valid header and trailer.'
  );
}

function assertArtifactEnvelope(
  value: unknown,
  expectedKind?: ArtifactKind
): asserts value is ArtifactEnvelope {
  assertRecord(value, 'artifact envelope');
  assertExactKeys(value, envelopeKeys, 'artifact envelope');
  if (value.schemaVersion !== 1) throw new Error('Artifact schemaVersion must be 1.');
  if (value.kind !== 'normalized' && value.kind !== 'chunks') {
    throw new Error('Artifact kind must be normalized or chunks.');
  }
  if (expectedKind !== undefined && value.kind !== expectedKind) {
    throw new Error(`Artifact kind does not match expected kind ${expectedKind}.`);
  }
  if (value.configVersion !== 'phase2-v1') {
    throw new Error('Artifact configVersion must be phase2-v1.');
  }
  if (!Array.isArray(value.payload)) throw new Error('Artifact payload must be an array.');

  if (value.kind === 'normalized') {
    for (const item of value.payload) assertStrictNormalizedBlock(item);
  } else {
    for (const item of value.payload) assertStrictChunkDraft(item);
  }
}

function assertStrictNormalizedBlock(value: unknown): asserts value is NormalizedBlock {
  assertRecord(value, 'normalized block');
  assertExactKeys(value, ['index', 'location', 'text', 'type'], 'normalized block');
  assertNormalizedBlock(value);
  if (!value.text.trim()) throw new Error('Normalized block text must not be empty.');
  assertStrictLocation(value.location);
  if (
    value.location.kind === 'document' &&
    value.type !== value.location.blockType
  ) {
    throw new Error('Normalized block type must match its document location block type.');
  }
}

function assertStrictChunkDraft(value: unknown): asserts value is ChunkDraft {
  assertRecord(value, 'chunk draft');
  assertExactKeys(value, ['content', 'index', 'sourceLocation'], 'chunk draft');
  assertChunkDraft(value);
  if (!value.content.trim()) throw new Error('Chunk content must not be empty.');
  assertStrictLocation(value.sourceLocation);
}

function assertStrictLocation(
  value: unknown
): asserts value is ProcessingSourceLocation {
  assertRecord(value, 'source location');
  assertProcessingSourceLocation(value);

  if (value.kind === 'page') {
    assertExactKeys(value, ['kind', 'label', 'page', 'schemaVersion'], 'page location');
    return;
  }

  const common = [
    'blockEnd',
    'blockStart',
    'blockType',
    'headingPath',
    'kind',
    'label',
    'schemaVersion'
  ];
  if (value.blockType === 'paragraph') {
    assertExactKeys(value, common, 'paragraph location');
  } else {
    assertExactKeys(
      value,
      [...common, 'rowEnd', 'rowStart', 'tableIndex'],
      'table location'
    );
  }

  if ('headingPath' in value) {
    if (
      !Array.isArray(value.headingPath) ||
      value.headingPath.length === 0 ||
      value.headingPath.some(
        (heading) => typeof heading !== 'string' || !heading.trim()
      )
    ) {
      throw new Error('headingPath must contain non-empty strings.');
    }
  }
}

function assertRecord(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const allowedKeys = new Set(allowed);
  const actual = Object.keys(value);
  if (actual.some((key) => !allowedKeys.has(key)) || actual.length < allowed.length - 1) {
    throw new Error(`${label} has an invalid field set.`);
  }

  const required = allowed.filter((key) => key !== 'headingPath');
  if (required.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} has an invalid field set.`);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Artifact numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalValue(record[key])])
    );
  }
  throw new Error('Artifact contains a value that JSON cannot encode.');
}

function isOutputLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    ('code' in error && error.code === 'ERR_BUFFER_TOO_LARGE' ||
      /maxoutputlength|larger than/i.test(error.message))
  );
}
