import { describe, expect, it } from 'vitest';
import { runCloudIsolationCheck } from './cloudIsolation';

describe('cloud workspace isolation', () => {
  it(
    'does not return another workspace file from match_spike_chunks',
    async () => {
      const report = await runCloudIsolationCheck();
      expect(report.returnedFileNames).toEqual([report.workspaceAFileName]);
      expect(report.returnedFileNames).not.toContain(
        report.workspaceBFileName
      );
    },
    30_000
  );
});
