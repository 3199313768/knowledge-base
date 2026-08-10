import { describe, expect, it } from 'vitest';
import { createMultilingualE5Provider } from './embed';

describe('multilingual E5 provider', () => {
  it(
    'returns normalized 384-dimensional vectors',
    async () => {
      const provider = await createMultilingualE5Provider();
      const [vector] = await provider.embedPassages(['年度客户报价方案']);
      expect(vector).toBeDefined();
      expect(vector).toHaveLength(384);
      const magnitude = Math.sqrt(
        vector!.reduce((sum, value) => sum + value ** 2, 0)
      );
      expect(magnitude).toBeCloseTo(1, 4);
    },
    120_000
  );
});
