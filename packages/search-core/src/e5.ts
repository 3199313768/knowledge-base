import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { env, pipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '@knowledge-base/contracts';

export const PINNED_MULTILINGUAL_E5_MODEL_ID = 'Xenova/multilingual-e5-small';
export const PINNED_MULTILINGUAL_E5_REVISION =
  '761b726dd34fb83930e26aab4e9ac3899aa1fa78';

export interface PinnedModelCacheFile {
  relativePath: string;
  sha256: string;
}

export interface PinnedModelCacheManifest {
  modelId: typeof PINNED_MULTILINGUAL_E5_MODEL_ID;
  revision: string;
  files: readonly PinnedModelCacheFile[];
}

export const PINNED_MULTILINGUAL_E5_CACHE: PinnedModelCacheManifest = {
  modelId: PINNED_MULTILINGUAL_E5_MODEL_ID,
  revision: PINNED_MULTILINGUAL_E5_REVISION,
  files: [
    {
      relativePath: 'Xenova/multilingual-e5-small/config.json',
      sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1'
    },
    {
      relativePath: 'Xenova/multilingual-e5-small/tokenizer.json',
      sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'
    },
    {
      relativePath: 'Xenova/multilingual-e5-small/tokenizer_config.json',
      sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b'
    },
    {
      relativePath: 'Xenova/multilingual-e5-small/onnx/model.onnx',
      sha256: '4aa845c27760e06e9a686b9d8b5d440eae4b6612cd09e5b522b716d3941f77ff'
    }
  ]
};

export interface E5ProviderOptions {
  cacheDir: string;
  localFilesOnly?: boolean;
  manifest?: PinnedModelCacheManifest;
}

export function assertEmbedding(vector: readonly number[]): void {
  if (vector.length !== 384 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding must contain exactly 384 finite numbers');
  }
}

export async function createMultilingualE5Provider(
  options: E5ProviderOptions
): Promise<EmbeddingProvider> {
  const manifest = options.manifest ?? PINNED_MULTILINGUAL_E5_CACHE;
  await assertPinnedModelCache(options.cacheDir, manifest);
  env.cacheDir = options.cacheDir;
  env.localModelPath = options.cacheDir;
  env.allowRemoteModels = false;

  const extractor = await pipeline(
    'feature-extraction',
    manifest.modelId,
    {
      cache_dir: options.cacheDir,
      local_files_only: true,
      revision: manifest.revision
    }
  );

  const embed = async (texts: readonly string[]): Promise<number[][]> => {
    const vectors: number[][] = [];
    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data as Float32Array);
      assertEmbedding(vector);
      vectors.push(vector);
    }
    return vectors;
  };

  return {
    dimensions: 384,
    embedPassages: (texts) => embed(texts.map((text) => `passage: ${text}`)),
    embedQuery: async (text) => (await embed([`query: ${text}`]))[0]!
  };
}

export async function assertPinnedModelCache(
  cacheDir: string,
  manifest: PinnedModelCacheManifest = PINNED_MULTILINGUAL_E5_CACHE
): Promise<void> {
  if (manifest.revision !== PINNED_MULTILINGUAL_E5_REVISION) {
    throw new Error('Pinned model revision mismatch');
  }
  for (const file of manifest.files) {
    const absolutePath = path.join(cacheDir, file.relativePath);
    const metadata = await stat(absolutePath);
    if (!metadata.isFile() || metadata.size === 0) {
      throw new Error(`Pinned model cache file is missing: ${file.relativePath}`);
    }
    const actual = await sha256File(absolutePath);
    if (actual !== file.sha256) {
      throw new Error(`Pinned model cache sha256 mismatch: ${file.relativePath}`);
    }
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}
