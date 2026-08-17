import { ProcessingFailure } from '../core/errors';
import type {
  OriginalStore,
  ProcessingRepository,
  StageHandler
} from '../core/ports';

export function createCleanupStage(dependencies: {
  repository: ProcessingRepository;
  originalStore: OriginalStore;
}): StageHandler {
  return async (job, context) => {
    if (job.stage !== 'cleanup') throw stageFailure();
    if (job.original.storagePath !== null) {
      await dependencies.originalStore.remove(job.original.storagePath, context.signal);
    }
    context.assertLease();
    await dependencies.repository.completeStage(job, null, context.signal);
  };
}

function stageFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'database_write_failed',
    'The claimed processing stage did not match the handler.',
    true
  );
}
