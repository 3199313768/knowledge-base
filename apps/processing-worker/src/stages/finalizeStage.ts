import { ProcessingFailure } from '../core/errors';
import type {
  ArtifactStore,
  Logger,
  ProcessingRepository,
  StageHandler
} from '../core/ports';

export function createFinalizeStage(dependencies: {
  repository: ProcessingRepository;
  artifactStore: ArtifactStore;
  logger: Logger;
}): StageHandler {
  return async (job, context) => {
    if (job.stage !== 'finalize') throw stageFailure();
    const warningCount = await dependencies.repository.countWarnings(
      job.versionId,
      context.signal
    );
    const status = warningCount === 0 ? 'searchable' : 'partially_searchable';
    context.assertLease();
    await dependencies.repository.finalizeVersion(
      job,
      status,
      warningCount === 0 ? null : 'ocr_required',
      context.signal
    );
    try {
      await dependencies.artifactStore.deleteVersion(
        job.workspaceId,
        job.versionId,
        new AbortController().signal
      );
    } catch {
      dependencies.logger.error('artifact_cleanup_failed', {
        workspaceId: job.workspaceId,
        fileId: job.fileId,
        versionId: job.versionId,
        jobId: job.jobId,
        stage: job.stage,
        code: 'artifact_cleanup_failed'
      });
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
