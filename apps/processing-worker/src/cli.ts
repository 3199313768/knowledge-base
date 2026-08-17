import { pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';

import { createMultilingualE5Provider } from '@knowledge-base/search-core';

import { sweepArtifacts } from './artifactSweeper';
import { loadWorkerConfig } from './config';
import { createBuiltinExtractorRegistry } from './extractors/registry';
import { createChunkRepository } from './infra/supabase/chunkRepository';
import {
  createArtifactStore,
  createOriginalStore
} from './infra/supabase/artifactStore';
import { createWorkerSupabaseClient } from './infra/supabase/client';
import { createProcessingRepository } from './infra/supabase/processingRepository';
import { createChunkStage } from './stages/chunkStage';
import { createEmbedStage } from './stages/embedStage';
import { createExtractStage } from './stages/extractStage';
import { createFinalizeStage } from './stages/finalizeStage';
import { createValidateStage } from './stages/validateStage';
import { runLoop, systemClock } from './runner';
import type { Logger } from './core/ports';

interface SignalHost {
  once(signal: NodeJS.Signals, listener: () => void): SignalHost;
  removeListener(signal: NodeJS.Signals, listener: () => void): SignalHost;
}

export interface WorkerRuntimeOptions {
  signalHost: SignalHost;
  sweepIntervalMs: number;
  sweep: (signal: AbortSignal) => Promise<void>;
  run: (signal: AbortSignal) => Promise<void>;
  repeat: (task: () => Promise<void>, milliseconds: number) => () => void;
  onSweepError?: () => void;
}

export async function startWorkerRuntime(
  options: WorkerRuntimeOptions
): Promise<void> {
  const shutdown = new AbortController();
  const onShutdown = () => shutdown.abort(new Error('worker shutdown requested'));
  options.signalHost.once('SIGINT', onShutdown);
  options.signalHost.once('SIGTERM', onShutdown);
  let stopSweep: () => void = () => undefined;
  try {
    await options.sweep(shutdown.signal);
    stopSweep = options.repeat(async () => {
      try {
        await options.sweep(shutdown.signal);
      } catch {
        options.onSweepError?.();
      }
    }, options.sweepIntervalMs);
    await options.run(shutdown.signal);
  } finally {
    stopSweep();
    options.signalHost.removeListener('SIGINT', onShutdown);
    options.signalHost.removeListener('SIGTERM', onShutdown);
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const config = await loadWorkerConfig(process.env);
  const client = createWorkerSupabaseClient(
    config.supabaseUrl,
    config.serviceRoleKey
  );
  const repository = createProcessingRepository(client as never, config.workerId);
  const artifactStore = createArtifactStore(client as never);
  const originalStore = createOriginalStore(client as never);
  const chunkRepository = createChunkRepository(client as never);
  const embeddingProvider = await createMultilingualE5Provider({
    cacheDir: config.modelCache,
    localFilesOnly: true
  });
  const logger = createLogger();
  const extractorRegistry = createBuiltinExtractorRegistry();
  const handlers = {
    validate: createValidateStage({ repository, originalStore }),
    extract: createExtractStage({
      repository,
      originalStore,
      artifactStore,
      extractorRegistry: { get: (kind) => extractorRegistry.get(kind) }
    }),
    chunk: createChunkStage({ repository, artifactStore }),
    embed: createEmbedStage({
      repository,
      artifactStore,
      chunkRepository,
      embeddingProvider
    }),
    finalize: createFinalizeStage({ repository, artifactStore, logger })
  };

  await startWorkerRuntime({
    signalHost: process,
    sweepIntervalMs: config.sweepIntervalMs,
    sweep: async (signal) => {
      await sweepArtifacts(
        { repository, artifactStore, clock: systemClock, logger },
        config.terminalGraceMs,
        signal
      );
    },
    repeat: (task, milliseconds) => systemClock.repeat(task, milliseconds),
    run: (signal) =>
      runLoop(
        {
          repository,
          artifactStore,
          handlers,
          clock: systemClock,
          logger,
          leaseSeconds: config.leaseSeconds,
          heartbeatMs: config.heartbeatMs,
          jobTimeoutMs: config.jobTimeoutMs
        },
        config.workerId,
        signal,
        config.idlePollMs,
        config.jobTimeoutMs
      ),
    onSweepError: () => logger.error('artifact_sweep_failed', { code: 'artifact_cleanup_failed' })
  });
}

function createLogger(): Logger {
  return {
    info: (event, fields) => console.info(event, safeFields(fields)),
    error: (event, fields) => console.error(event, safeFields(fields))
  };
}

function safeFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const allowed = new Set([
    'workspaceId',
    'fileId',
    'versionId',
    'jobId',
    'stage',
    'code',
    'retryable'
  ]);
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) =>
      allowed.has(key) &&
      (typeof value === 'string' || typeof value === 'boolean')
    )
  );
}

const runningAsCli = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (runningAsCli) {
  void main().catch(() => {
    process.exitCode = 1;
  });
}
