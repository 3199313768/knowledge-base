import { decodeArtifact, encodeArtifact } from '../artifacts/codec';
import { chunkBlocks } from '../chunking/chunkBlocks';
import { ProcessingFailure } from '../core/errors';
import type {
  ArtifactStore,
  ProcessingRepository,
  StageHandler
} from '../core/ports';

export function createChunkStage(dependencies: {
  repository: ProcessingRepository;
  artifactStore: ArtifactStore;
}): StageHandler {
  return async (job, context) => {
    if (job.stage !== 'chunk') throw stageFailure();
    let normalized;
    try {
      normalized = await decodeArtifact(
        await dependencies.artifactStore.read(
          job.workspaceId,
          job.versionId,
          'normalized',
          context.signal
        ),
        'normalized'
      );
    } catch (error) {
      if (error instanceof ProcessingFailure) throw error;
      throw artifactFailure();
    }
    const chunks = chunkBlocks(normalized.payload);
    if (chunks.length === 0) {
      throw new ProcessingFailure(
        'empty_content',
        'The document produced no searchable chunks.',
        false
      );
    }
    const artifact = await encodeArtifact({
      schemaVersion: 1,
      kind: 'chunks',
      configVersion: 'phase2-v1',
      payload: chunks
    });
    context.assertLease();
    await dependencies.artifactStore.write(
      job.workspaceId,
      job.versionId,
      'chunks',
      artifact,
      context.signal
    );
    context.assertLease();
    await dependencies.repository.completeStage(job, 'embed', context.signal);
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
    'The normalized artifact could not be decoded.',
    true
  );
}
