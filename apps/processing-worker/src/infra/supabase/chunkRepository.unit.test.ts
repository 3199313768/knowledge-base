import { expect, it } from 'vitest';

import type { ClaimedJob, EmbeddedChunk } from '../../core/ports';
import { ProcessingFailure } from '../../core/errors';
import { createChunkRepository } from './chunkRepository';

const job: ClaimedJob = {
  jobId: '10000000-0000-4000-8000-000000000001',
  versionId: '20000000-0000-4000-8000-000000000002',
  fileId: '30000000-0000-4000-8000-000000000003',
  workspaceId: '40000000-0000-4000-8000-000000000004',
  stage: 'embed',
  attempt: 1,
  leaseExpiresAt: new Date('2026-08-10T10:00:00.000Z'),
  original: {
    storagePath: 'workspace/file.pdf',
    mimeType: 'application/pdf',
    checksum: `sha256:${'a'.repeat(64)}`,
    sizeBytes: 12
  }
};

function chunk(index: number): EmbeddedChunk {
  return {
    index,
    content: `chunk-${index}`,
    sourceLocation: {
      schemaVersion: 1,
      kind: 'page',
      page: index + 1,
      label: `Page ${index + 1}`
    },
    embedding: Array.from({ length: 384 }, (_, vectorIndex) =>
      vectorIndex === index % 384 ? 1 : 0
    )
  };
}

function fakeClient(currentVersionId: string | null = null) {
  const events: Array<{ operation: string; payload?: unknown }> = [];
  const contentTable = {
    delete: () => ({
      eq: async (_column: string, value: string) => {
        events.push({ operation: 'delete', payload: value });
        return { data: null, error: null };
      }
    }),
    insert: async (rows: unknown[]) => {
      events.push({ operation: 'insert', payload: rows });
      return { data: null, error: null };
    }
  };
  const client = {
    from: (table: string) => table === 'file_versions'
      ? {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  status: 'processing',
                  files: { current_version_id: currentVersionId }
                },
                error: null
              })
            })
          })
        }
      : contentTable
  };
  return { client, events };
}

it('deletes then deterministically rebuilds only the claimed unpublished version in batches', async () => {
  const fake = fakeClient('50000000-0000-4000-8000-000000000005');
  const repository = createChunkRepository(fake.client, 100);
  const chunks = Array.from({ length: 101 }, (_, index) => chunk(index));

  await repository.replaceUnpublished(job, chunks, new AbortController().signal);

  expect(fake.events.map((event) => event.operation)).toEqual([
    'delete', 'insert', 'insert'
  ]);
  expect(fake.events[0]?.payload).toBe(job.versionId);
  const firstBatch = fake.events[1]?.payload as Array<Record<string, unknown>>;
  const secondBatch = fake.events[2]?.payload as Array<Record<string, unknown>>;
  expect(firstBatch).toHaveLength(100);
  expect(secondBatch).toHaveLength(1);
  expect(firstBatch[0]).toEqual({
    version_id: job.versionId,
    chunk_index: 0,
    content: 'chunk-0',
    source_location: chunk(0).sourceLocation,
    search_tokens: ['chunk', '0'],
    embedding: chunk(0).embedding
  });
});

it('stores deterministic lexical tokens and uses an empty list for punctuation-only chunks', async () => {
  const fake = fakeClient('50000000-0000-4000-8000-000000000005');
  const repository = createChunkRepository(fake.client);

  await repository.replaceUnpublished(
    job,
    [
      { ...chunk(0), content: '报价 Quote-2025' },
      { ...chunk(1), content: '!!! ---' }
    ],
    new AbortController().signal
  );

  const inserted = fake.events.find((event) => event.operation === 'insert')
    ?.payload as Array<Record<string, unknown>>;
  expect(inserted.map((row) => row.search_tokens)).toEqual([
    ['报价', 'quote', '2025'],
    []
  ]);
});

it.each([
  ['wrong dimensions', [1, 2]],
  ['NaN', Array.from({ length: 384 }, (_, index) => index === 0 ? NaN : 0)],
  ['Infinity', Array.from({ length: 384 }, (_, index) => index === 0 ? Infinity : 0)]
])('rejects %s before a database request', async (_name, embedding) => {
  const fake = fakeClient();
  const repository = createChunkRepository(fake.client);

  const error = await repository.replaceUnpublished(
    job,
    [{ ...chunk(0), embedding }],
    new AbortController().signal
  ).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(ProcessingFailure);
  expect(error).toMatchObject({ code: 'embedding_failed', retryable: true });
  expect(fake.events).toEqual([]);
});

it('refuses to mutate chunks when the claimed version is already current', async () => {
  const fake = fakeClient(job.versionId);
  const repository = createChunkRepository(fake.client);

  const error = await repository.replaceUnpublished(
    job,
    [chunk(0)],
    new AbortController().signal
  ).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(ProcessingFailure);
  expect(error).toMatchObject({ code: 'database_write_failed' });
  expect(fake.events).toEqual([]);
});

it('persists deterministic lexical terms for every chunk, including empty arrays', async () => {
  const fake = fakeClient('50000000-0000-4000-8000-000000000005');
  const repository = createChunkRepository(fake.client);
  await repository.replaceUnpublished(job, [
    { ...chunk(0), content: '去年 Quote-2025 报价' },
    { ...chunk(1), content: '!!! ---' }
  ], new AbortController().signal);

  const rows = fake.events.find((event) => event.operation === 'insert')?.payload as Array<Record<string, unknown>>;
  expect(rows.map((row) => row.search_tokens)).toEqual([
    ['去年', 'quote', '2025', '报价'],
    []
  ]);
});
