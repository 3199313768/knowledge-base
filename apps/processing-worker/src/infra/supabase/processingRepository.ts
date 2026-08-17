import type {
  ClaimedJob,
  FailureReport,
  ProcessingRepository,
  TerminalVersion
} from '../../core/ports';
import { ProcessingFailure } from '../../core/errors';
import type { ActiveProcessingStage } from '../../core/stageMachine';
import type {
  ProcessingErrorCode,
  ProcessingSourceLocation,
  ProcessingWarning
} from '@knowledge-base/contracts';

interface QueryResult {
  data: unknown;
  error: unknown;
  count?: number | null;
}

interface SupabaseBoundary {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<QueryResult>;
  from(table: string): unknown;
}

interface SelectBuilder {
  eq(column: string, value: unknown): SelectBuilder;
  is(column: string, value: null): SelectBuilder;
  in(column: string, values: readonly string[]): SelectBuilder;
  lt(column: string, value: string): SelectBuilder;
  order(column: string, options: Readonly<Record<string, unknown>>): SelectBuilder;
  limit(limit: number): PromiseLike<QueryResult>;
  single(): PromiseLike<QueryResult>;
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>;
}

interface TableBoundary {
  select(columns: string, options?: Readonly<Record<string, unknown>>): SelectBuilder;
}

const activeStages = new Set<ActiveProcessingStage>([
  'validate',
  'extract',
  'chunk',
  'embed',
  'finalize'
]);
const terminalStatuses = new Set<TerminalVersion['status']>([
  'searchable',
  'partially_searchable',
  'failed'
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function createProcessingRepository(
  client: SupabaseBoundary,
  configuredWorkerId: string
): ProcessingRepository {
  return {
    async claim(workerId, leaseSeconds, signal) {
      signal.throwIfAborted();
      if (workerId !== configuredWorkerId) throw infrastructureFailure();
      const result = await client.rpc('claim_processing_job', {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds
      });
      assertSuccess(result);
      const rows = result.data;
      if (!Array.isArray(rows)) throw infrastructureFailure();
      if (rows.length === 0) return null;
      if (rows.length !== 1) throw infrastructureFailure();
      const row = parseClaimRow(rows[0]);
      signal.throwIfAborted();
      return row;
    },
    async heartbeat(job, workerId, leaseSeconds, signal) {
      signal.throwIfAborted();
      if (workerId !== configuredWorkerId) throw infrastructureFailure();
      const result = await client.rpc('heartbeat_processing_job', {
        p_job_id: job.jobId,
        p_worker_id: configuredWorkerId,
        p_lease_seconds: leaseSeconds
      });
      assertSuccess(result);
      const expiresAt = parseDate(result.data);
      signal.throwIfAborted();
      return expiresAt;
    },
    async completeStage(job, nextStage, signal) {
      await rpcVoid(client, 'complete_processing_stage', {
        p_job_id: job.jobId,
        p_worker_id: configuredWorkerId,
        p_next_stage: nextStage
      }, signal);
    },
    async failStage(job, failure, signal) {
      await failStage(client, configuredWorkerId, job.jobId, failure, signal);
    },
    async recordWarning(job, warning, signal) {
      if (await warningExists(client, job, warning, signal)) return;
      await rpcVoid(client, 'record_processing_warning', {
        p_job_id: job.jobId,
        p_worker_id: configuredWorkerId,
        p_code: warning.code,
        p_source_location: warning.sourceLocation ?? null
      }, signal);
    },
    async finalizeVersion(job, status, errorCode, signal) {
      await rpcVoid(client, 'finalize_processing_version', {
        p_job_id: job.jobId,
        p_worker_id: configuredWorkerId,
        p_status: status,
        p_error_code: errorCode
      }, signal);
    },
    async countWarnings(versionId, signal) {
      assertUuid(versionId);
      signal.throwIfAborted();
      const table = client.from('processing_warnings') as TableBoundary;
      const result = await table
        .select('id', { count: 'exact', head: true })
        .eq('version_id', versionId);
      assertSuccess(result);
      if (!Number.isSafeInteger(result.count) || (result.count ?? -1) < 0) {
        throw infrastructureFailure();
      }
      return result.count!;
    },
    async listTerminalVersions(olderThan, limit, signal) {
      signal.throwIfAborted();
      const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
      const table = client.from('file_versions') as TableBoundary;
      const result = await table
        .select('id,workspace_id,status,updated_at')
        .in('status', ['searchable', 'partially_searchable', 'failed'])
        .lt('updated_at', olderThan.toISOString())
        .order('updated_at', { ascending: true })
        .limit(boundedLimit);
      assertSuccess(result);
      if (!Array.isArray(result.data) || result.data.length > boundedLimit) {
        throw infrastructureFailure();
      }
      return result.data.map(parseTerminalRow);
    }
  };
}

async function warningExists(
  client: SupabaseBoundary,
  job: ClaimedJob,
  warning: ProcessingWarning,
  signal: AbortSignal
): Promise<boolean> {
  signal.throwIfAborted();
  const table = client.from('processing_warnings') as TableBoundary;
  let query = table
    .select('id')
    .eq('version_id', job.versionId)
    .eq('stage', job.stage)
    .eq('code', warning.code);
  query = warning.sourceLocation === undefined
    ? query.is('source_location', null)
    : query.eq('source_location', warning.sourceLocation);
  const result = await query.limit(1);
  assertSuccess(result);
  if (!Array.isArray(result.data) || result.data.length > 1) {
    throw infrastructureFailure();
  }
  return result.data.length === 1;
}

async function failStage(
  client: SupabaseBoundary,
  workerId: string,
  jobId: string,
  failure: FailureReport,
  signal: AbortSignal
): Promise<void> {
  await rpcVoid(client, 'fail_processing_stage', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error_code: failure.code,
    p_permanent: !failure.retryable
  }, signal);
}

async function rpcVoid(
  client: SupabaseBoundary,
  name: string,
  args: Readonly<Record<string, unknown>>,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const result = await client.rpc(name, args);
  assertSuccess(result);
  signal.throwIfAborted();
}

function parseClaimRow(value: unknown): ClaimedJob {
  const row = record(value);
  assertUuid(row.job_id);
  assertUuid(row.version_id);
  assertUuid(row.file_id);
  assertUuid(row.workspace_id);
  if (row.stage === 'cleanup') {
    if (row.storage_path !== null && typeof row.storage_path !== 'string') {
      throw infrastructureFailure();
    }
    if (typeof row.storage_path === 'string' && !row.storage_path.trim()) {
      throw infrastructureFailure();
    }
    if (!Number.isSafeInteger(row.attempt) || (row.attempt as number) < 1 || (row.attempt as number) > 3) {
      throw infrastructureFailure();
    }
    return {
      jobId: row.job_id as string,
      versionId: row.version_id as string,
      fileId: row.file_id as string,
      workspaceId: row.workspace_id as string,
      stage: 'cleanup',
      original: { storagePath: row.storage_path },
      attempt: row.attempt as number,
      leaseExpiresAt: parseDate(row.lease_expires_at)
    };
  }
  if (!activeStages.has(row.stage as ActiveProcessingStage)) throw infrastructureFailure();
  if (typeof row.storage_path !== 'string' || !row.storage_path.trim()) {
    throw infrastructureFailure();
  }
  if (typeof row.mime_type !== 'string' || !row.mime_type.trim()) {
    throw infrastructureFailure();
  }
  if (typeof row.checksum !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(row.checksum)) {
    throw infrastructureFailure();
  }
  if (!Number.isSafeInteger(row.size_bytes) || (row.size_bytes as number) < 1 || (row.size_bytes as number) > 100_000_000) {
    throw infrastructureFailure();
  }
  if (!Number.isSafeInteger(row.attempt) || (row.attempt as number) < 1 || (row.attempt as number) > 3) {
    throw infrastructureFailure();
  }
  return {
    jobId: row.job_id as string,
    versionId: row.version_id as string,
    fileId: row.file_id as string,
    workspaceId: row.workspace_id as string,
    stage: row.stage as ActiveProcessingStage,
    original: {
      storagePath: row.storage_path,
      mimeType: row.mime_type,
      checksum: row.checksum,
      sizeBytes: row.size_bytes as number
    },
    attempt: row.attempt as number,
    leaseExpiresAt: parseDate(row.lease_expires_at)
  };
}

function parseTerminalRow(value: unknown): TerminalVersion {
  const row = record(value);
  assertUuid(row.id);
  assertUuid(row.workspace_id);
  if (!terminalStatuses.has(row.status as TerminalVersion['status'])) {
    throw infrastructureFailure();
  }
  return {
    versionId: row.id as string,
    workspaceId: row.workspace_id as string,
    status: row.status as TerminalVersion['status'],
    terminalAt: parseDate(row.updated_at)
  };
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string') throw infrastructureFailure();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw infrastructureFailure();
  return date;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw infrastructureFailure();
  }
  return value as Record<string, unknown>;
}

function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw infrastructureFailure();
  }
}

function assertSuccess(result: QueryResult): void {
  if (result.error) throw infrastructureFailure();
}

function infrastructureFailure(): ProcessingFailure {
  return new ProcessingFailure(
    'database_write_failed',
    'The processing database operation failed.',
    true
  );
}

export type ProcessingSupabaseBoundary = SupabaseBoundary;
