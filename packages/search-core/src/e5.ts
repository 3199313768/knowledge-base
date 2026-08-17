import { env, pipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '@knowledge-base/contracts';

export interface E5ProviderOptions {
  cacheDir: string;
  localFilesOnly?: boolean;
}

export function assertEmbedding(vector: readonly number[]): void {
  if (vector.length !== 384 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding must contain exactly 384 finite numbers');
  }
}

export async function createMultilingualE5Provider(
  options: E5ProviderOptions
): Promise<EmbeddingProvider> {
  env.cacheDir = options.cacheDir;
  env.allowRemoteModels = false;

  const extractor = await pipeline(
    'feature-extraction',
    'Xenova/multilingual-e5-small'
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
