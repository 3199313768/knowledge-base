import { gzip as gzipCallback, gunzip as gunzipCallback } from 'node:zlib';
import { promisify } from 'node:util';

import type { ChunkDraft, NormalizedBlock } from '@knowledge-base/contracts';
import { describe, expect, it } from 'vitest';

import {
  decodeArtifact,
  encodeArtifact,
  type ArtifactEnvelope
} from './codec';

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);
const maxArtifactBytes = 100_000_000;

const normalizedPayload: NormalizedBlock[] = [
  {
    index: 0,
    type: 'paragraph',
    text: 'Normalized text.',
    location: {
      schemaVersion: 1,
      kind: 'page',
      page: 1,
      label: '第 1 页'
    }
  }
];

const chunkPayload: ChunkDraft[] = [
  {
    index: 0,
    content: 'Chunk text.',
    sourceLocation: {
      schemaVersion: 1,
      kind: 'document',
      blockType: 'table',
      blockStart: 3,
      blockEnd: 3,
      tableIndex: 1,
      rowStart: 2,
      rowEnd: 4,
      label: 'Table 1'
    }
  }
];

describe('artifact codec', () => {
  it.each<ArtifactEnvelope>([
    {
      schemaVersion: 1,
      kind: 'normalized',
      configVersion: 'phase2-v1',
      payload: normalizedPayload
    },
    {
      schemaVersion: 1,
      kind: 'chunks',
      configVersion: 'phase2-v1',
      payload: chunkPayload
    }
  ])('round-trips a valid $kind envelope', async (envelope) => {
    const bytes = await encodeArtifact(envelope);

    await expect(decodeArtifact(bytes, envelope.kind)).resolves.toEqual(envelope);
  });

  it('encodes canonical JSON into byte-identical gzip data with fixed metadata', async () => {
    const envelope: ArtifactEnvelope = {
      schemaVersion: 1,
      kind: 'normalized',
      configVersion: 'phase2-v1',
      payload: normalizedPayload
    };

    const first = await encodeArtifact(envelope);
    const second = await encodeArtifact(structuredClone(envelope));

    expect(second).toEqual(first);
    expect(Array.from(first.slice(4, 10))).toEqual([0, 0, 0, 0, 2, 255]);
    await expect(gunzip(first).then((value) => value.toString('utf8'))).resolves.toBe(
      '{"configVersion":"phase2-v1","kind":"normalized","payload":[{"index":0,"location":{"kind":"page","label":"第 1 页","page":1,"schemaVersion":1},"text":"Normalized text.","type":"paragraph"}],"schemaVersion":1}'
    );
  });

  it.each([
    {
      name: 'an unsupported schema version',
      value: { schemaVersion: 2, kind: 'normalized', configVersion: 'phase2-v1', payload: [] }
    },
    {
      name: 'an unsupported config version',
      value: { schemaVersion: 1, kind: 'normalized', configVersion: 'phase2-v2', payload: [] }
    },
    {
      name: 'an alternate envelope shape',
      value: {
        schemaVersion: 1,
        kind: 'normalized',
        configVersion: 'phase2-v1',
        payload: [],
        trailing: true
      }
    },
    {
      name: 'a payload item with unknown fields',
      value: {
        schemaVersion: 1,
        kind: 'normalized',
        configVersion: 'phase2-v1',
        payload: [{ ...normalizedPayload[0], extra: true }]
      }
    },
    {
      name: 'an invalid sparse payload item',
      value: {
        schemaVersion: 1,
        kind: 'normalized',
        configVersion: 'phase2-v1',
        payload: [null]
      }
    },
    {
      name: 'an invalid source location',
      value: {
        schemaVersion: 1,
        kind: 'chunks',
        configVersion: 'phase2-v1',
        payload: [
          {
            index: 0,
            content: 'Chunk text.',
            sourceLocation: {
              schemaVersion: 1,
              kind: 'page',
              page: 0,
              label: '第 0 页'
            }
          }
        ]
      }
    },
    {
      name: 'unknown location fields',
      value: {
        schemaVersion: 1,
        kind: 'normalized',
        configVersion: 'phase2-v1',
        payload: [
          {
            ...normalizedPayload[0],
            location: { ...normalizedPayload[0]!.location, tableIndex: 1 }
          }
        ]
      }
    },
    {
      name: 'a payload that does not match its kind',
      value: {
        schemaVersion: 1,
        kind: 'normalized',
        configVersion: 'phase2-v1',
        payload: chunkPayload
      }
    }
  ])('rejects $name', async ({ value }) => {
    const bytes = await gzip(JSON.stringify(value));

    await expect(decodeArtifact(bytes, value.kind as 'normalized' | 'chunks')).rejects.toThrow();
  });

  it('rejects an expected-kind mismatch and trailing JSON data', async () => {
    const valid = await encodeArtifact({
      schemaVersion: 1,
      kind: 'normalized',
      configVersion: 'phase2-v1',
      payload: normalizedPayload
    });
    const trailing = await gzip(
      '{"schemaVersion":1,"kind":"normalized","configVersion":"phase2-v1","payload":[]} true'
    );

    await expect(decodeArtifact(valid, 'chunks')).rejects.toThrow('kind');
    await expect(decodeArtifact(trailing, 'normalized')).rejects.toThrow();
  });

  it('rejects concatenated gzip members even when the extra output is whitespace', async () => {
    const valid = await encodeArtifact({
      schemaVersion: 1,
      kind: 'normalized',
      configVersion: 'phase2-v1',
      payload: normalizedPayload
    });
    const whitespaceMember = await gzip(' ');
    const concatenated = Buffer.concat([valid, whitespaceMember]);

    await expect(decodeArtifact(concatenated, 'normalized')).rejects.toThrow(
      'canonical JSON'
    );
  });

  it('rejects a concatenated gzip member with an empty body', async () => {
    const valid = await encodeArtifact({
      schemaVersion: 1,
      kind: 'normalized',
      configVersion: 'phase2-v1',
      payload: normalizedPayload
    });
    const emptyMember = await gzip('');
    const concatenated = Buffer.concat([valid, emptyMember]);

    await expect(decodeArtifact(concatenated, 'normalized')).rejects.toThrow(
      'single gzip member'
    );
  });

  it('rejects non-finite input before JSON encoding can coerce it', async () => {
    const envelope = {
      schemaVersion: 1,
      kind: 'normalized',
      configVersion: 'phase2-v1',
      payload: [{ ...normalizedPayload[0], index: Number.POSITIVE_INFINITY }]
    } as unknown as ArtifactEnvelope;

    await expect(encodeArtifact(envelope)).rejects.toThrow('index');
  });

  it.each([
    {
      type: 'table',
      location: {
        schemaVersion: 1,
        kind: 'document',
        blockType: 'paragraph',
        blockStart: 1,
        blockEnd: 1,
        label: 'Paragraph 1'
      }
    },
    {
      type: 'paragraph',
      location: {
        schemaVersion: 1,
        kind: 'document',
        blockType: 'table',
        blockStart: 1,
        blockEnd: 1,
        tableIndex: 1,
        rowStart: 1,
        rowEnd: 1,
        label: 'Table 1'
      }
    }
  ])(
    'rejects a normalized $type block whose document location has a different block type',
    async ({ type, location }) => {
      const bytes = await gzip(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'normalized',
          configVersion: 'phase2-v1',
          payload: [{ index: 0, type, text: 'Text.', location }]
        })
      );

      await expect(decodeArtifact(bytes, 'normalized')).rejects.toThrow('block type');
    }
  );

  it('rejects decompressed output above the hard 100 MB ceiling', async () => {
    const oversized = await gzip(Buffer.alloc(maxArtifactBytes + 1, 32), { level: 1 });

    await expect(decodeArtifact(oversized, 'normalized')).rejects.toThrow('100 MB');
  }, 20_000);
});
