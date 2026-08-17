import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProcessingFailure } from '../core/errors';
import type {
  OriginalStore,
  ProcessingRepository,
  StageHandler
} from '../core/ports';
import { validateOriginalFile } from '../validation/fileValidation';

export function createValidateStage(dependencies: {
  repository: ProcessingRepository;
  originalStore: OriginalStore;
}): StageHandler {
  return async (job, context) => {
    if (job.stage !== 'validate') throw stageFailure();
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
      await validateOriginalFile({
        filePath,
        declaredMime: job.original.mimeType,
        expectedSizeBytes: job.original.sizeBytes
      });
      context.assertLease();
      await dependencies.repository.completeStage(job, 'extract', context.signal);
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
