import { assertProcessingSourceLocation } from '@knowledge-base/contracts';
import { assertEmbedding, tokenizeLexical } from '@knowledge-base/search-core';

import { ProcessingFailure } from '../../core/errors';
import type {
  ChunkRepository,
  ClaimedJob,
  EmbeddedChunk
} from '../../core/ports';

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface ChunkSupabaseBoundary {
  from(table: string): unknown;
}

interface FileVersionTable {
  select(columns: string): {
    eq(column: string, value: string): {
      single(): PromiseLike<QueryResult>;
    };
  };
}

interface ContentChunkTable {
  delete(): {
    eq(column: string, value: string): PromiseLike<QueryResult>;
  };
  insert(rows: readonly Record<string, unknown>[]): PromiseLike<QueryResult>;
}

export function createChunkRepository(
  client: ChunkSupabaseBoundary,
  batchSize = 100
): ChunkRepository {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error('batchSize must be between 1 and 1000');
  }
  return {
    async replaceUnpublished(job, chunks, signal) {
      validateChunks(job, chunks);
      signal.throwIfAborted();
      await assertUnpublishedProcessingVersion(client, job);
      signal.throwIfAborted();

      const table = client.from('content_chunks') as ContentChunkTable;
      const deleted = await table.delete().eq('version_id', job.versionId);
      if (deleted.error) throw databaseFailure();

      for (let offset = 0; offset < chunks.length; offset += batchSize) {
        signal.throwIfAborted();
        const rows = chunks.slice(offset, offset + batchSize).map((chunk) => ({
          version_id: job.versionId,
          chunk_index: chunk.index,
          content: chunk.content,
          source_location: chunk.sourceLocation,
          search_tokens: tokenizeLexical(chunk.content),
          embedding: [...chunk.embedding]
        }));
        const inserted = await table.insert(rows);
        if (inserted.error) throw databaseFailure();
      }
      signal.throwIfAborted();
    }
  };
}

function validateChunks(job: ClaimedJob, chunks: readonly EmbeddedChunk[]): void {
  if (job.stage !== 'embed') throw databaseFailure();
  for (const [position, chunk] of chunks.entries()) {
    if (chunk.index !== position || !chunk.content.trim()) throw databaseFailure();
    try {
      assertProcessingSourceLocation(chunk.sourceLocation);
    } catch {
      throw databaseFailure();
    }
    try {
      assertEmbedding(chunk.embedding);
    } catch {
      throw new ProcessingFailure(
        'embedding_failed',
        'An embedding did not satisfy the worker contract.',
        true
      );
    }
  }
}

async function assertUnpublishedProcessingVersion(
  client: ChunkSupabaseBoundary,
  job: ClaimedJob
): Promise<void> {
  const table = client.from('file_versions') as FileVersionTable;
  const result = await table
    .select('status,files!inner(current_version_id)')
    .eq('id', job.versionId)
    .single();
  if (result.error) throw databaseFailure();
  const row = record(result.data);
  const files = Array.isArray(row.files) ? row.files[0] : row.files;
  const file = record(files);
  if (row.status !== 'processing' || file.current_version_id === job.versionId) {
    throw databaseFailure();
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw databaseFailure();
  }
  return value as Record<string, unknown>;
}

function databaseFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'database_write_failed',
    'The chunk database operation failed.',
    true
  );
}

export type ChunkRepositorySupabaseBoundary = ChunkSupabaseBoundary;
