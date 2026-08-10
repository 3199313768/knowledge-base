import { expect, it, vi } from 'vitest';

const extractor = vi.fn(async (text: string) => ({
  data: Float32Array.from([text.length])
}));
const pipeline = vi.fn(async () => extractor);

vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline
}));

import { createMultilingualE5Provider } from './embed';

it('prefixes passages and queries before passing them to the model', async () => {
  const provider = await createMultilingualE5Provider();

  await provider.embedPassages(['报价方案']);
  await provider.embedQuery('报价方案');

  expect(extractor).toHaveBeenNthCalledWith(1, 'passage: 报价方案', {
    pooling: 'mean',
    normalize: true
  });
  expect(extractor).toHaveBeenNthCalledWith(2, 'query: 报价方案', {
    pooling: 'mean',
    normalize: true
  });
});
