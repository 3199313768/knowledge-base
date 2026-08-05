import { describe, expect, it } from 'vitest';
import { createMultilingualE5Provider } from './embed';
import { evaluateSearch } from './evaluate';

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

describe('semantic evaluation', () => {
  it(
    'retrieves at least 80 percent of expected files in the top five',
    async () => {
      const report = await evaluateSearch();
      expect(report.queryCount).toBe(10);
      expect(report.recallAt5).toBeGreaterThanOrEqual(0.8);
      expect(
        report.results.every((result) => result.returnedFileNames.length <= 5)
      ).toBe(true);
    },
    300_000
  );
});
