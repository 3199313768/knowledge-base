import { expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMultilingualE5Provider } from './e5';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

it('embeds cached multilingual E5 vectors offline', async () => {
  const provider = await createMultilingualE5Provider({
    cacheDir: path.join(repoRoot, 'validation/phase-0/model-cache'),
    localFilesOnly: true
  });
  const [passage] = await provider.embedPassages(['年度客户报价方案']);
  const query = await provider.embedQuery('年度客户报价方案');

  expect(passage).toHaveLength(384);
  expect(query).toHaveLength(384);
  expect(Math.hypot(...passage!)).toBeCloseTo(1, 4);
  expect(Math.hypot(...query)).toBeCloseTo(1, 4);
  expect(passage!.every(Number.isFinite)).toBe(true);
  expect(query.every(Number.isFinite)).toBe(true);
});
