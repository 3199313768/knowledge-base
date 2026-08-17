import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { loadWorkerConfig } from './config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function validEnvironment(): Promise<Record<string, string>> {
  const cache = await mkdtemp(path.join(tmpdir(), 'worker-config-'));
  temporaryDirectories.push(cache);
  const modelRoot = path.join(cache, 'Xenova', 'multilingual-e5-small');
  await mkdir(path.join(modelRoot, 'onnx'), { recursive: true });
  await Promise.all(
    ['config.json', 'tokenizer.json', 'tokenizer_config.json'].map((name) =>
      writeFile(path.join(modelRoot, name), '{}')
    )
  );
  await writeFile(path.join(modelRoot, 'onnx', 'model.onnx'), 'model');
  return {
    SUPABASE_URL: 'https://synthetic-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-secret',
    PROCESSING_WORKER_ID: 'worker-a',
    PROCESSING_MODEL_CACHE: cache
  };
}

it('loads worker-only settings with the frozen timing defaults', async () => {
  const config = await loadWorkerConfig(await validEnvironment());

  expect(config).toMatchObject({
    workerId: 'worker-a',
    leaseSeconds: 120,
    heartbeatMs: 40_000,
    idlePollMs: 2_000,
    sweepIntervalMs: 900_000,
    terminalGraceMs: 3_600_000,
    jobTimeoutMs: 900_000
  });
});

it('names missing variables without exposing any supplied secret value', async () => {
  const environment = await validEnvironment();
  delete environment.PROCESSING_WORKER_ID;

  await expect(loadWorkerConfig(environment)).rejects.toThrow(
    'PROCESSING_WORKER_ID'
  );
  await expect(loadWorkerConfig(environment)).rejects.not.toThrow(
    'synthetic-service-role-secret'
  );
});

it('rejects a heartbeat that cannot renew before the lease expires', async () => {
  const environment = {
    ...(await validEnvironment()),
    PROCESSING_LEASE_SECONDS: '30',
    PROCESSING_HEARTBEAT_SECONDS: '30'
  };

  await expect(loadWorkerConfig(environment)).rejects.toThrow(
    'PROCESSING_HEARTBEAT_SECONDS'
  );
});

it('rejects a cache missing a pinned model file before worker startup', async () => {
  const environment = await validEnvironment();
  await rm(
    path.join(
      environment.PROCESSING_MODEL_CACHE!,
      'Xenova',
      'multilingual-e5-small',
      'onnx',
      'model.onnx'
    )
  );

  await expect(loadWorkerConfig(environment)).rejects.toThrow(
    'PROCESSING_MODEL_CACHE'
  );
});
