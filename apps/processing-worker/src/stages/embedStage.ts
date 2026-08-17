import { assertEmbedding } from '@knowledge-base/search-core';

import { decodeArtifact } from '../artifacts/codec';
import { ProcessingFailure } from '../core/errors';
import type {
  ArtifactStore,
  ChunkRepository,
  EmbeddingProvider,
  ProcessingRepository,
  StageHandler
} from '../core/ports';

const embeddingBatchSize = 32;

export function createEmbedStage(dependencies: {
  repository: ProcessingRepository;
  artifactStore: ArtifactStore;
  chunkRepository: ChunkRepository;
  embeddingProvider: EmbeddingProvider;
}): StageHandler {
  return async (job, context) => {
    if (job.stage !== 'embed') throw stageFailure();
    let chunksArtifact;
    try {
      chunksArtifact = await decodeArtifact(
        await dependencies.artifactStore.read(
          job.workspaceId,
          job.versionId,
          'chunks',
          context.signal
        ),
        'chunks'
      );
    } catch (error) {
      if (error instanceof ProcessingFailure) throw error;
      throw artifactFailure();
    }

    const vectors: number[][] = [];
    try {
      for (let offset = 0; offset < chunksArtifact.payload.length; offset += embeddingBatchSize) {
        context.assertLease();
        const batch = chunksArtifact.payload.slice(offset, offset + embeddingBatchSize);
        const embedded = await dependencies.embeddingProvider.embedPassages(
          batch.map((chunk) => chunk.content)
        );
        if (embedded.length !== batch.length) throw embeddingFailure();
        for (const vector of embedded) {
          assertEmbedding(vector);
          vectors.push(vector);
        }
      }
    } catch (error) {
      if (error instanceof ProcessingFailure) throw error;
      throw embeddingFailure();
    }

    const chunks = chunksArtifact.payload.map((chunk, index) => ({
      ...chunk,
      embedding: vectors[index]!
    }));
    context.assertLease();
    await dependencies.chunkRepository.replaceUnpublished(
      job,
      chunks,
      context.signal
    );
    context.assertLease();
    await dependencies.repository.completeStage(job, 'finalize', context.signal);
  };
}

function stageFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'database_write_failed',
    'The claimed processing stage did not match the handler.',
    true
  );
}

function artifactFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'artifact_io_failed',
    'The chunk artifact could not be decoded.',
    true
  );
}

function embeddingFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'embedding_failed',
    'Local embedding generation failed.',
    true
  );
}
