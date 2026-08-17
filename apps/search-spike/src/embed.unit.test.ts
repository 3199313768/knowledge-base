import { expect, it, vi } from 'vitest';

const { createProvider, provider } = vi.hoisted(() => {
  const provider = {
    dimensions: 384 as const,
    embedPassages: vi.fn(async () => []),
    embedQuery: vi.fn(async () => [])
  };

  return {
    createProvider: vi.fn(async () => provider),
    provider
  };
});

vi.mock('@knowledge-base/search-core', () => ({
  createMultilingualE5Provider: createProvider
}));

import { createMultilingualE5Provider } from './embed';

it('preserves the shared provider compatibility import surface', async () => {
  const options = {
    cacheDir: '/synthetic/cache',
    localFilesOnly: true
  };

  await expect(createMultilingualE5Provider(options)).resolves.toBe(provider);
  expect(createProvider).toHaveBeenCalledWith(options);
});
