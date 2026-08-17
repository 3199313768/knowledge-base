import { expect, it } from 'vitest';

import type {
  ArtifactStore,
  Clock,
  ProcessingRepository,
  TerminalVersion
} from './core/ports';
import { sweepArtifacts } from './artifactSweeper';

const terminal: TerminalVersion = {
  workspaceId: '40000000-0000-4000-8000-000000000004',
  versionId: '20000000-0000-4000-8000-000000000002',
  status: 'failed',
  terminalAt: new Date('2026-08-10T08:00:00.000Z')
};

function fake(candidates: TerminalVersion[]) {
  const deleted: string[] = [];
  let requestedLimit = 0;
  let requestedAge: Date | undefined;
  const repository = {
    listTerminalVersions: async (olderThan: Date, limit: number) => {
      requestedAge = olderThan;
      requestedLimit = limit;
      return candidates;
    }
  } as unknown as ProcessingRepository;
  const artifactStore = {
    deleteVersion: async (workspaceId: string, versionId: string) => {
      deleted.push(`${workspaceId}/${versionId}`);
    }
  } as unknown as ArtifactStore;
  const clock = {
    now: () => new Date('2026-08-10T10:00:00.000Z')
  } as Clock;
  return {
    dependencies: {
      repository,
      artifactStore,
      clock,
      logger: { info: () => undefined, error: () => undefined }
    },
    deleted,
    requested: () => ({ limit: requestedLimit, age: requestedAge })
  };
}

it('requests at most 100 terminal versions older than the grace period', async () => {
  const harness = fake([terminal]);

  await expect(sweepArtifacts(
    harness.dependencies,
    3_600_000,
    new AbortController().signal
  )).resolves.toBe(1);

  expect(harness.requested()).toEqual({
    limit: 100,
    age: new Date('2026-08-10T09:00:00.000Z')
  });
  expect(harness.deleted).toEqual([`${terminal.workspaceId}/${terminal.versionId}`]);
});

it('skips any active version returned by a defensive fake', async () => {
  const active = { ...terminal, status: 'processing' } as unknown as TerminalVersion;
  const harness = fake([active]);

  await expect(sweepArtifacts(
    harness.dependencies,
    3_600_000,
    new AbortController().signal
  )).resolves.toBe(0);

  expect(harness.deleted).toEqual([]);
});

it('caps deletion even if a faulty repository returns more than 100 rows', async () => {
  const candidates = Array.from({ length: 101 }, (_, index) => ({
    ...terminal,
    versionId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  }));
  const harness = fake(candidates);

  await sweepArtifacts(harness.dependencies, 3_600_000, new AbortController().signal);

  expect(harness.deleted).toHaveLength(100);
});

it.each([
  ['malformed workspace', { ...terminal, workspaceId: '../workspace' }],
  ['workspace-level target', { ...terminal, versionId: '' }]
])('rejects %s without issuing a deletion', async (_name, candidate) => {
  const harness = fake([candidate]);

  await expect(sweepArtifacts(
    harness.dependencies,
    3_600_000,
    new AbortController().signal
  )).rejects.toThrow('artifact sweep candidate');

  expect(harness.deleted).toEqual([]);
});
