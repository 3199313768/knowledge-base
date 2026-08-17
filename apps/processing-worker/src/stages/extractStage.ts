import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { encodeArtifact } from '../artifacts/codec';
import { ProcessingFailure } from '../core/errors';
import type {
  ArtifactStore,
  ExtractorRegistry,
  OriginalStore,
  ProcessingRepository,
  StageHandler
} from '../core/ports';
import { validateOriginalFile } from '../validation/fileValidation';

export function createExtractStage(dependencies: {
  repository: ProcessingRepository;
  originalStore: OriginalStore;
  artifactStore: ArtifactStore;
  extractorRegistry: ExtractorRegistry;
}): StageHandler {
  return async (job, context) => {
    if (job.stage !== 'extract') throw stageFailure();
    const directory = await mkdtemp(
      path.join(tmpdir(), `knowledge-base-${job.jobId}-`)
    );
    const filePath = path.join(directory, 'original');
    try {
      await dependencies.originalStore.download(
        job.original,
        filePath,
        context.signal
      );
      const validated = await validateOriginalFile({
        filePath,
        declaredMime: job.original.mimeType,
        expectedSizeBytes: job.original.sizeBytes
      });
      const actualChecksum = `sha256:${createHash('sha256')
        .update(await readFile(filePath))
        .digest('hex')}`;
      if (actualChecksum !== job.original.checksum) {
        throw new ProcessingFailure(
          'corrupt_file',
          'The original file checksum changed before extraction.',
          false
        );
      }

      const extractor = dependencies.extractorRegistry.get(validated.kind);
      if (!extractor) {
        throw new ProcessingFailure(
          'unsupported_type',
          'No extractor is registered for this file type.',
          false
        );
      }
      let result;
      try {
        result = await extractor.extract(validated, context.signal);
      } catch (error) {
        if (error instanceof ProcessingFailure) throw error;
        throw new ProcessingFailure(
          'corrupt_file',
          'The file could not be extracted.',
          false
        );
      }
      const artifact = await encodeArtifact({
        schemaVersion: 1,
        kind: 'normalized',
        configVersion: 'phase2-v1',
        payload: result.blocks
      });
      context.assertLease();
      await dependencies.artifactStore.write(
        job.workspaceId,
        job.versionId,
        'normalized',
        artifact,
        context.signal
      );
      for (const warning of result.warnings) {
        context.assertLease();
        await dependencies.repository.recordWarning(job, warning, context.signal);
      }
      context.assertLease();
      await dependencies.repository.completeStage(job, 'chunk', context.signal);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

function stageFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'database_write_failed',
    'The claimed processing stage did not match the handler.',
    true
  );
}
