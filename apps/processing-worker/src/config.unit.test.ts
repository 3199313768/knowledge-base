import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { loadWorkerConfig } from './config';
import type { PinnedModelCacheManifest } from '@knowledge-base/search-core';

const temporaryDirectories: string[] = [];
const syntheticManifest: PinnedModelCacheManifest = {
  modelId: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  files: [
    {
      relativePath: 'Xenova/multilingual-e5-small/config.json',
      sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
    },
    {
      relativePath: 'Xenova/multilingual-e5-small/tokenizer.json',
      sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
    },
    {
      relativePath: 'Xenova/multilingual-e5-small/tokenizer_config.json',
      sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
    },
    {
      relativePath: 'Xenova/multilingual-e5-small/onnx/model.onnx',
      sha256: '98ad61a25e3683b6adf2474b01bbe1c27de6aad2ce3a80ff4140fe473c14e691'
    }
  ]
};

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
  await writeFile(path.join(modelRoot, 'onnx', 'model.onnx'), 'model\n');
  return {
    SUPABASE_URL: 'https://synthetic-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-secret',
    PROCESSING_WORKER_ID: 'worker-a',
    PROCESSING_MODEL_CACHE: cache
  };
}

it('loads worker-only settings with the frozen timing defaults', async () => {
  const config = await loadWorkerConfig(await validEnvironment(), {
    modelCacheManifest: syntheticManifest
  });

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

  await expect(loadWorkerConfig(environment, {
    modelCacheManifest: syntheticManifest
  })).rejects.toThrow(
    'PROCESSING_WORKER_ID'
  );
  await expect(loadWorkerConfig(environment, {
    modelCacheManifest: syntheticManifest
  })).rejects.not.toThrow(
    'synthetic-service-role-secret'
  );
});

it('rejects a heartbeat that cannot renew before the lease expires', async () => {
  const environment = {
    ...(await validEnvironment()),
    PROCESSING_LEASE_SECONDS: '30',
    PROCESSING_HEARTBEAT_SECONDS: '30'
  };

  await expect(loadWorkerConfig(environment, {
    modelCacheManifest: syntheticManifest
  })).rejects.toThrow(
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

  await expect(loadWorkerConfig(environment, {
    modelCacheManifest: syntheticManifest
  })).rejects.toThrow(
    'PROCESSING_MODEL_CACHE'
  );
});

it('rejects a cache file whose sha256 does not match the pinned manifest', async () => {
  const environment = await validEnvironment();
  await writeFile(
    path.join(
      environment.PROCESSING_MODEL_CACHE!,
      'Xenova',
      'multilingual-e5-small',
      'config.json'
    ),
    '{"changed":true}'
  );

  await expect(loadWorkerConfig(environment, {
    modelCacheManifest: syntheticManifest
  })).rejects.toThrow(
    'PROCESSING_MODEL_CACHE'
  );
});
