import type {
  ArtifactStore,
  Clock,
  Logger,
  ProcessingRepository,
  TerminalVersion
} from './core/ports';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const terminalStatuses = new Set<TerminalVersion['status']>([
  'searchable',
  'partially_searchable',
  'failed'
]);

export async function sweepArtifacts(
  dependencies: {
    repository: ProcessingRepository;
    artifactStore: ArtifactStore;
    clock: Clock;
    logger: Logger;
  },
  graceMs: number,
  signal: AbortSignal
): Promise<number> {
  signal.throwIfAborted();
  const olderThan = new Date(dependencies.clock.now().getTime() - graceMs);
  const candidates = await dependencies.repository.listTerminalVersions(
    olderThan,
    100,
    signal
  );
  let deleted = 0;
  for (const candidate of candidates.slice(0, 100)) {
    signal.throwIfAborted();
    if (!terminalStatuses.has(candidate.status)) continue;
    if (candidate.terminalAt >= olderThan) continue;
    assertCandidate(candidate);
    try {
      await dependencies.artifactStore.deleteVersion(
        candidate.workspaceId,
        candidate.versionId,
        signal
      );
      deleted += 1;
    } catch {
      dependencies.logger.error('artifact_cleanup_failed', {
        workspaceId: candidate.workspaceId,
        versionId: candidate.versionId,
        code: 'artifact_cleanup_failed'
      });
    }
  }
  return deleted;
}

function assertCandidate(candidate: TerminalVersion): void {
  if (
    !uuidPattern.test(candidate.workspaceId) ||
    !uuidPattern.test(candidate.versionId)
  ) {
    throw new Error('Invalid artifact sweep candidate identifiers.');
  }
}
