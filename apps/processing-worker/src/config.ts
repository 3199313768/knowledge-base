import {
  assertPinnedModelCache,
  type PinnedModelCacheManifest
} from '@knowledge-base/search-core';

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  workerId: string;
  modelCache: string;
  leaseSeconds: number;
  heartbeatMs: number;
  idlePollMs: number;
  sweepIntervalMs: number;
  terminalGraceMs: number;
  jobTimeoutMs: number;
}

export interface WorkerConfigOptions {
  modelCacheManifest?: PinnedModelCacheManifest;
}

export async function loadWorkerConfig(
  environment: Readonly<Record<string, string | undefined>>,
  options: WorkerConfigOptions = {}
): Promise<WorkerConfig> {
  const supabaseUrl = required(environment, 'SUPABASE_URL');
  const serviceRoleKey = required(environment, 'SUPABASE_SERVICE_ROLE_KEY');
  const workerId = required(environment, 'PROCESSING_WORKER_ID');
  const modelCache = required(environment, 'PROCESSING_MODEL_CACHE');

  validateUrl(supabaseUrl);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(workerId)) {
    throw configError('PROCESSING_WORKER_ID');
  }

  const leaseSeconds = integer(environment, 'PROCESSING_LEASE_SECONDS', 120);
  const heartbeatSeconds = integer(
    environment,
    'PROCESSING_HEARTBEAT_SECONDS',
    40
  );
  const idlePollSeconds = integer(
    environment,
    'PROCESSING_IDLE_POLL_SECONDS',
    2
  );
  const sweepSeconds = integer(
    environment,
    'PROCESSING_ARTIFACT_SWEEP_SECONDS',
    15 * 60
  );
  const graceSeconds = integer(
    environment,
    'PROCESSING_TERMINAL_ARTIFACT_GRACE_SECONDS',
    60 * 60
  );
  const jobTimeoutSeconds = integer(
    environment,
    'PROCESSING_JOB_TIMEOUT_SECONDS',
    15 * 60
  );

  if (leaseSeconds < 30 || leaseSeconds > 900) {
    throw configError('PROCESSING_LEASE_SECONDS');
  }
  if (heartbeatSeconds >= leaseSeconds) {
    throw configError('PROCESSING_HEARTBEAT_SECONDS');
  }
  if (jobTimeoutSeconds <= heartbeatSeconds) {
    throw configError('PROCESSING_JOB_TIMEOUT_SECONDS');
  }
  if (graceSeconds < sweepSeconds) {
    throw configError('PROCESSING_TERMINAL_ARTIFACT_GRACE_SECONDS');
  }

  await assertWorkerModelCache(modelCache, options.modelCacheManifest);
  return {
    supabaseUrl,
    serviceRoleKey,
    workerId,
    modelCache,
    leaseSeconds,
    heartbeatMs: heartbeatSeconds * 1_000,
    idlePollMs: idlePollSeconds * 1_000,
    sweepIntervalMs: sweepSeconds * 1_000,
    terminalGraceMs: graceSeconds * 1_000,
    jobTimeoutMs: jobTimeoutSeconds * 1_000
  };
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string
): string {
  const value = environment[name]?.trim();
  if (!value) throw configError(name);
  return value;
}

function integer(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number
): number {
  const raw = environment[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw configError(name);
  return value;
}

function validateUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw configError('SUPABASE_URL');
    }
  } catch {
    throw configError('SUPABASE_URL');
  }
}

async function assertWorkerModelCache(
  cacheRoot: string,
  manifest?: PinnedModelCacheManifest
): Promise<void> {
  try {
    await assertPinnedModelCache(cacheRoot, manifest);
  } catch {
    throw configError('PROCESSING_MODEL_CACHE');
  }
}

function configError(variable: string): Error {
  return new Error(`Invalid worker configuration: ${variable}`);
}
