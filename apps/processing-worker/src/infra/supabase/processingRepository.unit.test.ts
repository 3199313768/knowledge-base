import { describe, expect, it } from 'vitest';

import { ProcessingFailure } from '../../core/errors';
import { createProcessingRepository } from './processingRepository';

const ids = {
  job: '10000000-0000-4000-8000-000000000001',
  version: '20000000-0000-4000-8000-000000000002',
  file: '30000000-0000-4000-8000-000000000003',
  workspace: '40000000-0000-4000-8000-000000000004'
};

function fakeClient() {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const claimRows = [{
    job_id: ids.job,
    version_id: ids.version,
    file_id: ids.file,
    workspace_id: ids.workspace,
    stage: 'validate',
    storage_path: `${ids.workspace}/${ids.version}/original.pdf`,
    original_url: null,
    mime_type: 'application/pdf',
    checksum: `sha256:${'a'.repeat(64)}`,
    size_bytes: 12,
    attempt: 1,
    lease_expires_at: '2026-08-10T10:00:00.000Z'
  }];
  let rpcError: { message: string } | null = null;
  let terminalRows: unknown[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return {
        data: name === 'claim_processing_job'
          ? claimRows
          : name === 'heartbeat_processing_job'
            ? '2026-08-10T10:01:00.000Z'
            : null,
        error: rpcError
      };
    },
    from: (table: string) => ({
      select: (_columns: string, options?: unknown) => {
        const state = { table, options, id: '', limit: 0 };
        const builder = {
          eq: (_column: string, value: unknown) => {
            state.id = String(value);
            return builder;
          },
          is: () => builder,
          in: () => builder,
          lt: () => builder,
          order: () => builder,
          limit: (limit: number) => {
            state.limit = limit;
            calls.push({ name: `limit:${table}`, args: limit });
            return Promise.resolve({ data: terminalRows, error: null });
          },
          single: async () => ({ data: null, error: null }),
          then: (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown
          ) => Promise.resolve({ data: null, count: 0, error: null }).then(resolve, reject)
        };
        return builder;
      }
    })
  };
  return {
    client,
    calls,
    claimRows,
    setRpcError: (message: string) => { rpcError = { message }; },
    setTerminalRows: (rows: unknown[]) => { terminalRows = rows; }
  };
}

describe('processing repository', () => {
  it('claims through the worker RPC and returns a domain DTO enriched with immutable file metadata', async () => {
    const fake = fakeClient();
    const repository = createProcessingRepository(fake.client, 'worker-a');

    const claimed = await repository.claim('worker-a', 120, new AbortController().signal);

    expect(fake.calls[0]).toEqual({
      name: 'claim_processing_job',
      args: { p_worker_id: 'worker-a', p_lease_seconds: 120 }
    });
    expect(claimed).toMatchObject({
      jobId: ids.job,
      versionId: ids.version,
      stage: 'validate',
      original: {
        mimeType: 'application/pdf',
        checksum: `sha256:${'a'.repeat(64)}`,
        sizeBytes: 12
      }
    });
    expect(claimed).not.toHaveProperty('job_id');
  });

  it('uses only the six frozen worker RPC names for job mutations', async () => {
    const fake = fakeClient();
    const repository = createProcessingRepository(fake.client, 'worker-a');
    const claimed = (await repository.claim('worker-a', 120, new AbortController().signal))!;
    const signal = new AbortController().signal;

    await repository.heartbeat(claimed, 'worker-a', 120, signal);
    await repository.completeStage(claimed, 'extract', signal);
    await repository.failStage(claimed, { code: 'model_load_failed', retryable: true }, signal);
    await repository.recordWarning(claimed, { code: 'ocr_required', message: 'safe' }, signal);
    await repository.finalizeVersion(claimed, 'partially_searchable', 'ocr_required', signal);

    expect(fake.calls.filter((call) => !call.name.startsWith('limit:')).map((call) => call.name))
      .toEqual([
        'claim_processing_job',
        'heartbeat_processing_job',
        'complete_processing_stage',
        'fail_processing_stage',
        'record_processing_warning',
        'finalize_processing_version'
      ]);
  });

  it('maps remote failures to a stable retryable infrastructure code', async () => {
    const fake = fakeClient();
    fake.setRpcError('secret database body');
    const repository = createProcessingRepository(fake.client, 'worker-a');

    const error = await repository.claim('worker-a', 120, new AbortController().signal)
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ProcessingFailure);
    expect(error).toMatchObject({ code: 'database_write_failed', retryable: true });
    expect((error as Error).message).not.toContain('secret database body');
  });

  it('caps terminal artifact candidates at 100 and parses terminal rows only', async () => {
    const fake = fakeClient();
    fake.setTerminalRows([{
      id: ids.version,
      workspace_id: ids.workspace,
      status: 'failed',
      updated_at: '2026-08-10T08:00:00.000Z'
    }]);
    const repository = createProcessingRepository(fake.client, 'worker-a');

    await expect(repository.listTerminalVersions(
      new Date('2026-08-10T09:00:00.000Z'),
      500,
      new AbortController().signal
    )).resolves.toEqual([{
      versionId: ids.version,
      workspaceId: ids.workspace,
      status: 'failed',
      terminalAt: new Date('2026-08-10T08:00:00.000Z')
    }]);
    expect(fake.calls).toContainEqual({ name: 'limit:file_versions', args: 100 });
  });

  it('does not append the same structured warning again when a stage retry replays', async () => {
    const fake = fakeClient();
    fake.setTerminalRows([{ id: '50000000-0000-4000-8000-000000000005' }]);
    const repository = createProcessingRepository(fake.client, 'worker-a');
    const claimed = (await repository.claim('worker-a', 120, new AbortController().signal))!;

    await repository.recordWarning(
      claimed,
      { code: 'ocr_required', message: 'safe' },
      new AbortController().signal
    );

    expect(fake.calls.some((call) => call.name === 'record_processing_warning'))
      .toBe(false);
  });
});
