import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

const { extractor, mockedEnv, pipeline } = vi.hoisted(() => {
  const extractor = vi.fn(async () => ({
    data: Float32Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0))
  }));
  const pipeline = vi.fn(async () => extractor);
  const mockedEnv: {
    allowRemoteModels?: boolean;
    cacheDir?: string;
    localModelPath?: string;
  } = {};

  return { extractor, mockedEnv, pipeline };
});

vi.mock('@huggingface/transformers', () => ({
  env: mockedEnv,
  pipeline
}));

import {
  PINNED_MULTILINGUAL_E5_REVISION,
  createMultilingualE5Provider,
  type PinnedModelCacheManifest
} from './e5';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  vi.clearAllMocks();
});

async function syntheticModelCache(): Promise<{
  cacheDir: string;
  manifest: PinnedModelCacheManifest;
}> {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'e5-provider-'));
  temporaryDirectories.push(cacheDir);
  const relativePath = 'Xenova/multilingual-e5-small/config.json';
  await mkdir(path.dirname(path.join(cacheDir, relativePath)), { recursive: true });
  await writeFile(path.join(cacheDir, relativePath), '{}');
  return {
    cacheDir,
    manifest: {
      modelId: 'Xenova/multilingual-e5-small',
      revision: PINNED_MULTILINGUAL_E5_REVISION,
      files: [{
        relativePath,
        sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
      }]
    }
  };
}

it('pins the model revision, disables remote files, and applies E5 prefixes', async () => {
  const { cacheDir, manifest } = await syntheticModelCache();
  const provider = await createMultilingualE5Provider({
    cacheDir,
    localFilesOnly: false,
    manifest
  });

  await provider.embedPassages(['报价方案']);
  await provider.embedQuery('报价方案');

  expect(mockedEnv.allowRemoteModels).toBe(false);
  expect(mockedEnv.localModelPath).toBe(cacheDir);
  expect(pipeline).toHaveBeenCalledWith(
    'feature-extraction',
    'Xenova/multilingual-e5-small',
    {
      cache_dir: cacheDir,
      local_files_only: true,
      revision: PINNED_MULTILINGUAL_E5_REVISION
    }
  );
  expect(extractor).toHaveBeenNthCalledWith(1, 'passage: 报价方案', {
    pooling: 'mean',
    normalize: true
  });
  expect(extractor).toHaveBeenNthCalledWith(2, 'query: 报价方案', {
    pooling: 'mean',
    normalize: true
  });
});

it.each([
  ['wrong length', Float32Array.from([1, 0])],
  ['NaN', Float32Array.from({ length: 384 }, (_, index) => (index === 0 ? NaN : 0))],
  ['Infinity', Float32Array.from({ length: 384 }, (_, index) => (index === 0 ? Infinity : 0))]
])('rejects extractor output with %s', async (_name, data) => {
  const { cacheDir, manifest } = await syntheticModelCache();
  extractor.mockResolvedValueOnce({ data });
  const provider = await createMultilingualE5Provider({
    cacheDir,
    localFilesOnly: true,
    manifest
  });

  await expect(provider.embedPassages(['报价方案'])).rejects.toThrow(
    '384 finite numbers'
  );
});
