import { env, pipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '@knowledge-base/contracts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export async function createMultilingualE5Provider(): Promise<EmbeddingProvider> {
  // Mainland networks often cannot reach huggingface.co; prefer HF_ENDPOINT/mirror.
  env.remoteHost = process.env.HF_ENDPOINT ?? 'https://hf-mirror.com';
  env.cacheDir =
    process.env.TRANSFORMERS_CACHE ??
    path.join(repoRoot, 'validation/phase-0/model-cache');

  const extractor = await pipeline(
    'feature-extraction',
    'Xenova/multilingual-e5-small'
  );

  const embed = async (texts: readonly string[]): Promise<number[][]> => {
    const vectors: number[][] = [];
    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      vectors.push(Array.from(output.data as Float32Array));
    }
    return vectors;
  };

  return {
    dimensions: 384,
    embedPassages: (texts) => embed(texts.map((text) => `passage: ${text}`)),
    embedQuery: async (text) => (await embed([`query: ${text}`]))[0]!
  };
}
