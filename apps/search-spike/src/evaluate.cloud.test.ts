import { describe, expect, it } from 'vitest';
import { evaluateSearch } from './evaluate';

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
