import { ProcessingFailure } from './core/errors';
import type {
  ClaimedJob,
  Clock,
  FailureReport,
  LeaseGuard,
  RunnerDependencies
} from './core/ports';

class LeaseLostError extends Error {
  constructor() {
    super('processing lease lost');
    this.name = 'LeaseLostError';
  }
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (milliseconds, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, milliseconds);
      signal.addEventListener('abort', abort, { once: true });
    }),
  repeat: (task, milliseconds) => {
    const timer = setInterval(() => void task(), milliseconds);
    return () => clearInterval(timer);
  },
  after: (task, milliseconds) => {
    const timer = setTimeout(task, milliseconds);
    return () => clearTimeout(timer);
  }
};

export async function runOne(
  dependencies: RunnerDependencies,
  workerId: string,
  signal: AbortSignal
): Promise<'processed' | 'idle'> {
  signal.throwIfAborted();
  const job = await dependencies.repository.claim(
    workerId,
    dependencies.leaseSeconds,
    signal
  );
  if (!job) return 'idle';

  const leaseController = new AbortController();
  const timeoutController = new AbortController();
  const heartbeatController = new AbortController();
  let timedOut = false;
  let leaseLost = false;
  const cancelTimeout = dependencies.clock.after(() => {
    timedOut = true;
    timeoutController.abort(new ProcessingFailure('worker_timeout', 'worker timeout', true));
  }, dependencies.jobTimeoutMs);
  const jobSignal = AbortSignal.any([
    signal,
    leaseController.signal,
    timeoutController.signal
  ]);
  const heartbeatSignal = AbortSignal.any([
    jobSignal,
    heartbeatController.signal
  ]);
  const guard: LeaseGuard = {
    signal: jobSignal,
    assertLease: () => {
      if (leaseLost) throw new LeaseLostError();
      jobSignal.throwIfAborted();
    }
  };

  const stopHeartbeat = dependencies.clock.repeat(async () => {
    if (heartbeatSignal.aborted) return;
    try {
      await dependencies.repository.heartbeat(
        job,
        workerId,
        dependencies.leaseSeconds,
        heartbeatSignal
      );
    } catch {
      leaseLost = true;
      leaseController.abort(new LeaseLostError());
    }
  }, dependencies.heartbeatMs);

  try {
    await dependencies.handlers[job.stage](job, guard);
  } catch (error) {
    if (leaseLost || error instanceof LeaseLostError) {
      dependencies.logger.error('processing_lease_lost', identifiers(job));
      return 'processed';
    }
    if (signal.aborted && !timedOut) return 'processed';

    const failure = toFailure(error, timedOut);
    await dependencies.repository.failStage(job, failure, signal);
    if (!failure.retryable || job.attempt >= 3) {
      await cleanupTerminalArtifacts(dependencies, job);
    }
    dependencies.logger.error('processing_stage_failed', {
      ...identifiers(job),
      code: failure.code,
      retryable: failure.retryable
    });
  } finally {
    stopHeartbeat();
    heartbeatController.abort();
    cancelTimeout();
  }
  return 'processed';
}

export async function runLoop(
  dependencies: RunnerDependencies,
  workerId: string,
  signal: AbortSignal,
  idlePollMs: number,
  shutdownBudgetMs: number
): Promise<void> {
  while (!signal.aborted) {
    const current = new AbortController();
    let cancelForcedShutdown: () => void = () => undefined;
    const onShutdown = () => {
      cancelForcedShutdown = dependencies.clock.after(
        () => current.abort(new Error('worker shutdown budget expired')),
        shutdownBudgetMs
      );
    };
    signal.addEventListener('abort', onShutdown, { once: true });
    try {
      const outcome = await runOne(dependencies, workerId, current.signal);
      if (outcome === 'idle' && !signal.aborted) {
        await dependencies.clock.sleep(idlePollMs, signal);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      signal.removeEventListener('abort', onShutdown);
      cancelForcedShutdown();
    }
  }
}

function toFailure(error: unknown, timedOut: boolean): FailureReport {
  if (timedOut) return { code: 'worker_timeout', retryable: true };
  if (error instanceof ProcessingFailure) {
    return { code: error.code, retryable: error.retryable };
  }
  return { code: 'database_write_failed', retryable: true };
}

async function cleanupTerminalArtifacts(
  dependencies: RunnerDependencies,
  job: ClaimedJob
): Promise<void> {
  try {
    await dependencies.artifactStore.deleteVersion(
      job.workspaceId,
      job.versionId,
      new AbortController().signal
    );
  } catch {
    dependencies.logger.error('artifact_cleanup_failed', {
      ...identifiers(job),
      code: 'artifact_cleanup_failed'
    });
  }
}

function identifiers(job: ClaimedJob): Record<string, string> {
  return {
    workspaceId: job.workspaceId,
    fileId: job.fileId,
    versionId: job.versionId,
    jobId: job.jobId,
    stage: job.stage
  };
}
