import { expect, it, vi } from 'vitest';

const { extractor, mockedEnv, pipeline } = vi.hoisted(() => {
  const extractor = vi.fn(async () => ({
    data: Float32Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0))
  }));
  const pipeline = vi.fn(async () => extractor);
  const mockedEnv: { allowRemoteModels?: boolean; cacheDir?: string } = {};

  return { extractor, mockedEnv, pipeline };
});

vi.mock('@huggingface/transformers', () => ({
  env: mockedEnv,
  pipeline
}));

import { createMultilingualE5Provider } from './e5';

it('disables remote models and applies E5 prefixes', async () => {
  const provider = await createMultilingualE5Provider({
    cacheDir: '/synthetic/cache',
    localFilesOnly: false
  });

  await provider.embedPassages(['报价方案']);
  await provider.embedQuery('报价方案');

  expect(mockedEnv.allowRemoteModels).toBe(false);
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
  extractor.mockResolvedValueOnce({ data });
  const provider = await createMultilingualE5Provider({
    cacheDir: '/synthetic/cache',
    localFilesOnly: true
  });

  await expect(provider.embedPassages(['报价方案'])).rejects.toThrow(
    '384 finite numbers'
  );
});
