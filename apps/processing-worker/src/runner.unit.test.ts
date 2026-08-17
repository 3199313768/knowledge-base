import { describe, expect, it, vi } from 'vitest';

import type {
  ClaimedJob,
  Clock,
  ProcessingRepository,
  RunnerDependencies
} from './core/ports';
import { ProcessingFailure } from './core/errors';
import { EventEmitter } from 'node:events';
import { startWorkerRuntime } from './cli';
import { runLoop, runOne, systemClock } from './runner';

const job: ClaimedJob = {
  jobId: '10000000-0000-4000-8000-000000000001',
  versionId: '20000000-0000-4000-8000-000000000002',
  fileId: '30000000-0000-4000-8000-000000000003',
  workspaceId: '40000000-0000-4000-8000-000000000004',
  stage: 'validate',
  attempt: 1,
  leaseExpiresAt: new Date('2026-08-10T10:00:00.000Z'),
  original: {
    storagePath: '40000000-0000-4000-8000-000000000004/file.pdf',
    mimeType: 'application/pdf',
    checksum: `sha256:${'a'.repeat(64)}`,
    sizeBytes: 12
  }
};

function createFake(options: {
  claimed?: ClaimedJob | null;
  handler?: RunnerDependencies['handlers']['validate'];
  heartbeat?: ProcessingRepository['heartbeat'];
} = {}) {
  const events: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const scheduled = new Set<() => Promise<void>>();
  const clock: Clock = {
    now: () => new Date('2026-08-10T09:00:00.000Z'),
    sleep: async () => undefined,
    repeat: (task) => {
      scheduled.add(task);
      return () => scheduled.delete(task);
    },
    after: () => () => undefined
  };
  const repository: ProcessingRepository = {
    claim: async () => {
      const claimed = options.claimed === undefined ? job : options.claimed;
      events.push(`claim:${claimed?.stage ?? 'idle'}`);
      return claimed;
    },
    heartbeat:
      options.heartbeat ??
      (async () => {
        events.push('heartbeat');
        return new Date('2026-08-10T10:01:00.000Z');
      }),
    completeStage: async (_job, next) => {
      events.push(`complete:${next}`);
    },
    failStage: async (_job, failure, signal) => {
      signal.throwIfAborted();
      events.push(`fail:${failure.code}:${failure.retryable ? 'retryable' : 'permanent'}`);
    },
    recordWarning: async () => undefined,
    finalizeVersion: async () => undefined,
    countWarnings: async () => 0,
    listTerminalVersions: async () => []
  };
  const dependencies: RunnerDependencies = {
    repository,
    artifactStore: {
      read: async () => new Uint8Array(),
      write: async () => undefined,
      deleteVersion: async () => {
        events.push('cleanup');
      }
    },
    handlers: {
      validate:
        options.handler ??
        (async (claimed, context) => {
          events.push('validate');
          context.assertLease();
          await repository.completeStage(claimed, 'extract', context.signal);
        }),
      extract: async () => undefined,
      chunk: async () => undefined,
      embed: async () => undefined,
      finalize: async () => undefined,
      cleanup: async () => undefined
    },
    clock,
    logger: {
      info: (_event, fields) => logs.push(fields),
      error: (_event, fields) => logs.push(fields)
    },
    leaseSeconds: 120,
    heartbeatMs: 40_000,
    jobTimeoutMs: 900_000
  };
  return { dependencies, events, logs, scheduled };
}

describe('runOne', () => {
  it('claims once and dispatches exactly the claimed validate stage', async () => {
    const fake = createFake();

    await expect(runOne(fake.dependencies, 'worker-a', new AbortController().signal))
      .resolves.toBe('processed');

    expect(fake.events).toEqual(['claim:validate', 'validate', 'complete:extract']);
    expect(fake.scheduled.size).toBe(0);
  });

  it('returns idle without starting a heartbeat when no job is claimed', async () => {
    const fake = createFake({ claimed: null });

    await expect(runOne(fake.dependencies, 'worker-a', new AbortController().signal))
      .resolves.toBe('idle');

    expect(fake.events).toEqual(['claim:idle']);
    expect(fake.scheduled.size).toBe(0);
  });

  it('reports a stable retryable code without logging the failure body', async () => {
    const secretBodyText = 'private extracted body';
    const fake = createFake({
      handler: async () => {
        throw new ProcessingFailure(
          'model_load_failed',
          secretBodyText,
          true
        );
      }
    });

    await expect(runOne(fake.dependencies, 'worker-a', new AbortController().signal))
      .resolves.toBe('processed');

    expect(fake.events).toContain('fail:model_load_failed:retryable');
    expect(JSON.stringify(fake.logs)).not.toContain(secretBodyText);
    expect(fake.scheduled.size).toBe(0);
  });

  it('refuses stage completion after heartbeat reports lease loss', async () => {
    let heartbeatTask: (() => Promise<void>) | undefined;
    const fake = createFake({
      heartbeat: async () => {
        throw new Error('active processing lease not owned by worker');
      },
      handler: async (claimed, context) => {
        heartbeatTask = [...fake.scheduled][0];
        await heartbeatTask?.();
        context.assertLease();
        await fake.dependencies.repository.completeStage(
          claimed,
          'extract',
          context.signal
        );
      }
    });

    await expect(runOne(fake.dependencies, 'worker-a', new AbortController().signal))
      .resolves.toBe('processed');

    expect(fake.events).not.toContain('complete:extract');
    expect(fake.events.some((event) => event.startsWith('fail:'))).toBe(false);
    expect(heartbeatTask).toBeTypeOf('function');
    expect(fake.scheduled.size).toBe(0);
  });

  it('maps the per-job timeout to worker_timeout and cleans terminal artifacts after fail', async () => {
    const timedJob = { ...job, attempt: 3 };
    let timeoutTask: (() => void) | undefined;
    const fake = createFake({
      claimed: timedJob,
      handler: async (_claimed, context) => {
        timeoutTask?.();
        context.signal.throwIfAborted();
      }
    });
    fake.dependencies.clock.after = (task) => {
      timeoutTask = task;
      return () => { timeoutTask = undefined; };
    };

    await expect(runOne(fake.dependencies, 'worker-a', new AbortController().signal))
      .resolves.toBe('processed');

    expect(fake.events).toEqual([
      'claim:validate',
      'fail:worker_timeout:retryable',
      'cleanup'
    ]);
    expect(timeoutTask).toBeUndefined();
  });
});

it('runLoop stops new claims on shutdown while allowing current work to finish', async () => {
  const shutdown = new AbortController();
  const fake = createFake({
    handler: async (claimed, context) => {
      shutdown.abort();
      context.assertLease();
      fake.events.push('finished-current');
      await fake.dependencies.repository.completeStage(claimed, 'extract', context.signal);
    }
  });

  await runLoop(fake.dependencies, 'worker-a', shutdown.signal, 2_000, 5_000);

  expect(fake.events).toEqual([
    'claim:validate',
    'finished-current',
    'complete:extract'
  ]);
  expect(fake.scheduled.size).toBe(0);
});

it('system clock sleep removes its abort listener after normal completion', async () => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, 'addEventListener');
  const remove = vi.spyOn(controller.signal, 'removeEventListener');

  await systemClock.sleep(0, controller.signal);

  expect(add).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('CLI runtime sweeps at startup, schedules the interval, and removes signal listeners', async () => {
  const processEvents = new EventEmitter();
  const events: string[] = [];
  let scheduledMs = 0;
  const running = startWorkerRuntime({
    signalHost: processEvents,
    sweepIntervalMs: 900_000,
    sweep: async () => { events.push('sweep'); },
    run: (signal) => new Promise<void>((resolve) => {
      events.push('run');
      signal.addEventListener('abort', () => resolve(), { once: true });
    }),
    repeat: (_task, milliseconds) => {
      scheduledMs = milliseconds;
      events.push('scheduled');
      return () => { events.push('cancelled'); };
    }
  });
  await vi.waitFor(() => expect(events).toEqual(['sweep', 'scheduled', 'run']));

  processEvents.emit('SIGTERM');
  await running;

  expect(scheduledMs).toBe(900_000);
  expect(events).toEqual(['sweep', 'scheduled', 'run', 'cancelled']);
  expect(processEvents.listenerCount('SIGINT')).toBe(0);
  expect(processEvents.listenerCount('SIGTERM')).toBe(0);
});
