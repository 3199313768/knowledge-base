// UNRUN until a dedicated database target is separately authorized.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  createWorkspace,
  runWithCloudHarness,
  type CloudHarness,
  type TestActor
} from './testHarness';

interface PreparedVersion {
  file_id: string;
  version_id: string;
  storage_path: string;
}

interface ClaimedJob {
  job_id: string;
  version_id: string;
  stage: ProcessingStage;
  attempt: number;
  checksum: string | null;
  size_bytes: number | null;
}

type ProcessingStage =
  | 'validate'
  | 'extract'
  | 'chunk'
  | 'embed'
  | 'finalize';

const PROCESSING_LEASE_SECONDS = 120;

function processingWorkerId(versionId: string): string {
  return `phase1-cloud-${versionId}`;
}

function nextProcessingStage(stage: Exclude<ProcessingStage, 'finalize'>): ProcessingStage {
  const nextStages: Record<Exclude<ProcessingStage, 'finalize'>, ProcessingStage> = {
    validate: 'extract',
    extract: 'chunk',
    chunk: 'embed',
    embed: 'finalize'
  };
  return nextStages[stage];
}

let trackActiveObject: ((path: string) => void) | undefined;
let trackActiveFixture:
  | ((fixture: Pick<PreparedVersion, 'file_id' | 'version_id'>) => void)
  | undefined;

function firstRow<T>(data: T[] | T | null): T | undefined {
  return Array.isArray(data) ? data[0] : (data ?? undefined);
}

function checksum(): string {
  return `sha256:${randomUUID().replaceAll('-', '').padEnd(64, '0')}`;
}

async function createUploadedVersion(
  client: SupabaseClient,
  workspaceId: string,
  label: string
): Promise<PreparedVersion> {
  const body = new Blob([`%PDF-1.4\n${label}\n`], {
    type: 'application/pdf'
  });
  const { data, error } = await client.rpc('prepare_file_upload', {
    p_workspace_id: workspaceId,
    p_display_name: `${label}.pdf`,
    p_mime_type: 'application/pdf',
    p_size_bytes: body.size,
    p_checksum: checksum()
  });
  if (error) throw error;
  const prepared = firstRow(data) as PreparedVersion | undefined;
  if (!prepared?.file_id || !prepared.version_id || !prepared.storage_path) {
    throw new Error('prepare_file_upload returned no prepared version');
  }
  trackActiveFixture?.(prepared);
  trackActiveObject?.(prepared.storage_path);

  const { data: signedUpload, error: signedUploadError } = await client.storage
    .from('documents')
    .createSignedUploadUrl(prepared.storage_path, { upsert: false });
  if (signedUploadError || !signedUpload?.token) {
    throw signedUploadError ?? new Error('signed upload token was not returned');
  }
  const { error: uploadError } = await client.storage
    .from('documents')
    .uploadToSignedUrl(prepared.storage_path, signedUpload.token, body, {
      contentType: 'application/pdf',
      upsert: false
    });
  if (uploadError) throw uploadError;

  const { error: completionError } = await client.rpc(
    'mark_upload_complete',
    { p_version_id: prepared.version_id }
  );
  if (completionError) throw completionError;
  return prepared;
}

async function createVersionUpdate(
  client: SupabaseClient,
  fileId: string,
  label: string
): Promise<PreparedVersion> {
  const body = new Blob([`%PDF-1.4\n${label}\n`], {
    type: 'application/pdf'
  });
  const { data, error } = await client.rpc('prepare_file_version_upload', {
    p_file_id: fileId,
    p_mime_type: 'application/pdf',
    p_size_bytes: body.size,
    p_checksum: checksum()
  });
  if (error) throw error;
  const prepared = firstRow(data) as PreparedVersion | undefined;
  if (!prepared?.file_id || !prepared.version_id || !prepared.storage_path) {
    throw new Error('prepare_file_version_upload returned no prepared version');
  }
  trackActiveFixture?.(prepared);
  trackActiveObject?.(prepared.storage_path);

  const { data: signedUpload, error: signedUploadError } = await client.storage
    .from('documents')
    .createSignedUploadUrl(prepared.storage_path, { upsert: false });
  if (signedUploadError || !signedUpload?.token) {
    throw signedUploadError ?? new Error('signed upload token was not returned');
  }
  const { error: uploadError } = await client.storage
    .from('documents')
    .uploadToSignedUrl(prepared.storage_path, signedUpload.token, body, {
      contentType: 'application/pdf',
      upsert: false
    });
  if (uploadError) throw uploadError;

  const { error: completionError } = await client.rpc(
    'mark_upload_complete',
    { p_version_id: prepared.version_id }
  );
  if (completionError) throw completionError;
  return prepared;
}

async function claimVersionAsService(
  admin: SupabaseClient,
  expectedVersionId: string
): Promise<void> {
  const { data, error } = await admin.rpc('claim_processing_job', {
    p_worker_id: processingWorkerId(expectedVersionId),
    p_lease_seconds: PROCESSING_LEASE_SECONDS
  });
  if (error) throw error;
  const claimed = firstRow(data) as ClaimedJob | undefined;
  expect(claimed?.version_id).toBe(expectedVersionId);
  expect(claimed?.checksum).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(claimed?.size_bytes).toBeGreaterThan(0);
}

async function publishVersionAsService(
  admin: SupabaseClient,
  versionId: string,
  status: 'searchable' | 'partially_searchable',
  errorCode?: string
): Promise<string> {
  const { data: job, error: jobError } = await admin
    .from('processing_jobs')
    .select('id')
    .eq('version_id', versionId)
    .eq('stage', 'finalize')
    .eq('status', 'running')
    .single();
  if (jobError) throw jobError;

  if (status === 'partially_searchable') {
    const { error: warningError } = await admin.rpc(
      'record_processing_warning',
      {
        p_job_id: job.id,
        p_worker_id: processingWorkerId(versionId),
        p_code: errorCode ?? 'partial_processing',
        p_source_location: null
      }
    );
    if (warningError) throw warningError;
  }

  const { error } = await admin.rpc('finalize_processing_version', {
    p_job_id: job.id,
    p_worker_id: processingWorkerId(versionId),
    p_status: status,
    p_error_code: errorCode ?? null
  });
  if (error) throw error;
  return job.id;
}

async function assertVersionFailedByStageFailure(
  admin: SupabaseClient,
  versionId: string
): Promise<void> {
  const { data, error } = await admin
    .from('file_versions')
    .select('status')
    .eq('id', versionId)
    .single();
  if (error) throw error;
  expect(data.status).toBe('failed');
}

async function currentVersion(
  client: SupabaseClient,
  fileId: string
): Promise<string | null> {
  const { data, error } = await client
    .from('files')
    .select('current_version_id')
    .eq('id', fileId)
    .single();
  if (error) throw error;
  return data.current_version_id;
}

async function completeRunningJobAsService(
  admin: SupabaseClient,
  versionId: string,
  succeeded: boolean,
  errorCode?: string
): Promise<string> {
  const { data: initialJob, error: jobError } = await admin
    .from('processing_jobs')
    .select('id, stage')
    .eq('version_id', versionId)
    .eq('status', 'running')
    .single();
  if (jobError) throw jobError;

  if (!succeeded) {
    const { error } = await admin.rpc('fail_processing_stage', {
      p_job_id: initialJob.id,
      p_worker_id: processingWorkerId(versionId),
      p_error_code: errorCode ?? 'processing_failed',
      p_permanent: true
    });
    if (error) throw error;
    return initialJob.id;
  }

  let runningJob = initialJob as { id: string; stage: ProcessingStage };
  while (runningJob.stage !== 'finalize') {
    const nextStage = nextProcessingStage(runningJob.stage);
    const { error: completionError } = await admin.rpc(
      'complete_processing_stage',
      {
        p_job_id: runningJob.id,
        p_worker_id: processingWorkerId(versionId),
        p_next_stage: nextStage
      }
    );
    if (completionError) throw completionError;

    const { data: claimData, error: claimError } = await admin.rpc(
      'claim_processing_job',
      {
        p_worker_id: processingWorkerId(versionId),
        p_lease_seconds: PROCESSING_LEASE_SECONDS
      }
    );
    if (claimError) throw claimError;
    const claimed = firstRow(claimData) as ClaimedJob | undefined;
    if (!claimed || claimed.version_id !== versionId) {
      throw new Error('successor processing job was not claimed');
    }
    runningJob = { id: claimed.job_id, stage: claimed.stage };
  }

  return initialJob.id;
}

async function addMember(
  harness: CloudHarness,
  workspaceId: string,
  actor: TestActor
): Promise<void> {
  const { error } = await harness.admin.from('memberships').insert({
    workspace_id: workspaceId,
    user_id: actor.userId,
    role: 'member'
  });
  if (error) throw error;
}

async function runProcessingTest(
  run: (harness: CloudHarness) => Promise<void>
): Promise<void> {
  await runWithCloudHarness(async (harness) => {
    trackActiveObject = (path) => harness.trackStoragePath(path);
    trackActiveFixture = ({ file_id, version_id }) => {
      harness.trackFile(file_id);
      harness.trackFileVersion(version_id);
    };
    try {
      await run(harness);
    } finally {
      trackActiveObject = undefined;
      trackActiveFixture = undefined;
    }
  });
}

async function insertChunk(
  admin: SupabaseClient,
  versionId: string,
  content: string
): Promise<string> {
  const { data, error } = await admin
    .from('content_chunks')
    .insert({
      version_id: versionId,
      chunk_index: 0,
      content,
      source_location: {
        schemaVersion: 1,
        kind: 'page',
        page: 1,
        label: '第 1 页'
      },
      search_tokens: [],
      embedding: Array.from({ length: 384 }, () => 0)
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

describe('processing state, audit, and device contracts', () => {
  it('keeps the old searchable version until a new version succeeds', () =>
    runProcessingTest(async (harness) => {
      const actor = await harness.createActor('uploader');
      const workspaceId = await createWorkspace(actor.client, harness);
      const first = await createUploadedVersion(
        actor.client,
        workspaceId,
        'first'
      );
      await claimVersionAsService(harness.admin, first.version_id);
      await insertChunk(harness.admin, first.version_id, 'first-visible');
      await completeRunningJobAsService(
        harness.admin,
        first.version_id,
        true
      );
      await publishVersionAsService(
        harness.admin,
        first.version_id,
        'searchable'
      );

      const second = await createVersionUpdate(
        actor.client,
        first.file_id,
        'second'
      );
      await claimVersionAsService(harness.admin, second.version_id);
      await insertChunk(harness.admin, second.version_id, 'failed-hidden');
      const { data: beforeFailure } = await actor.client
        .from('content_chunks')
        .select('content');
      expect(beforeFailure).toEqual([{ content: 'first-visible' }]);
      await completeRunningJobAsService(
        harness.admin,
        second.version_id,
        false,
        'extract_failed'
      );
      await assertVersionFailedByStageFailure(
        harness.admin,
        second.version_id
      );
      expect(await currentVersion(actor.client, first.file_id)).toBe(
        first.version_id
      );

      const third = await createVersionUpdate(
        actor.client,
        first.file_id,
        'third'
      );
      await claimVersionAsService(harness.admin, third.version_id);
      await insertChunk(harness.admin, third.version_id, 'partial-visible');
      const { data: beforeSwitch } = await actor.client
        .from('content_chunks')
        .select('content');
      expect(beforeSwitch).toEqual([{ content: 'first-visible' }]);
      await completeRunningJobAsService(
        harness.admin,
        third.version_id,
        true
      );
      const { data: thirdFinalizeJob } = await harness.admin
        .from('processing_jobs')
        .select('id')
        .eq('version_id', third.version_id)
        .eq('stage', 'finalize')
        .single();
      const { error: missingPartialCodeError } = await harness.admin.rpc(
        'finalize_processing_version',
        {
          p_job_id: thirdFinalizeJob?.id,
          p_worker_id: processingWorkerId(third.version_id),
          p_status: 'partially_searchable',
          p_error_code: null
        }
      );
      expect(missingPartialCodeError?.message).toContain(
        'requires an error code'
      );
      await publishVersionAsService(
        harness.admin,
        third.version_id,
        'partially_searchable',
        'some_pages_unavailable'
      );
      expect(await currentVersion(actor.client, first.file_id)).toBe(
        third.version_id
      );
      const { data: afterSwitch } = await actor.client
        .from('content_chunks')
        .select('content');
      expect(afterSwitch).toEqual([{ content: 'partial-visible' }]);

      const fourth = await createVersionUpdate(
        actor.client,
        first.file_id,
        'fourth'
      );
      await claimVersionAsService(harness.admin, fourth.version_id);
      await insertChunk(harness.admin, fourth.version_id, 'successful-visible');
      expect(await currentVersion(actor.client, first.file_id)).toBe(
        third.version_id
      );
      await completeRunningJobAsService(
        harness.admin,
        fourth.version_id,
        true
      );
      await publishVersionAsService(
        harness.admin,
        fourth.version_id,
        'searchable'
      );
      expect(await currentVersion(actor.client, first.file_id)).toBe(
        fourth.version_id
      );
      const { data: afterSuccessfulSwitch } = await actor.client
        .from('content_chunks')
        .select('content');
      expect(afterSuccessfulSwitch).toEqual([
        { content: 'successful-visible' }
      ]);
    }));

  it('rejects invalid transitions and ordinary JWT worker access', () =>
    runProcessingTest(async (harness) => {
      const actor = await harness.createActor('transition-owner');
      const workspaceId = await createWorkspace(actor.client, harness);
      const { data, error: prepareError } = await actor.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceId,
          p_display_name: 'awaiting.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(prepareError).toBeNull();
      const awaiting = firstRow(data) as PreparedVersion;
      harness.trackFile(awaiting.file_id);
      harness.trackFileVersion(awaiting.version_id);
      const { error: awaitingJumpError } = await harness.admin
        .from('file_versions')
        .update({ status: 'searchable' })
        .eq('id', awaiting.version_id);
      expect(awaitingJumpError).not.toBeNull();

      const uploaded = await createUploadedVersion(
        actor.client,
        workspaceId,
        'worker-private'
      );
      const { error: ordinaryClaimError } = await actor.client.rpc(
        'claim_processing_job',
        {
          p_worker_id: 'forged-worker',
          p_lease_seconds: PROCESSING_LEASE_SECONDS
        }
      );
      expect(ordinaryClaimError).not.toBeNull();
      const { error: ordinaryCompleteError } = await actor.client.rpc(
        'complete_processing_stage',
        {
          p_job_id: randomUUID(),
          p_worker_id: 'forged-worker',
          p_next_stage: 'extract'
        }
      );
      const { error: ordinaryFinalizeError } = await actor.client.rpc(
        'finalize_processing_version',
        {
          p_job_id: randomUUID(),
          p_worker_id: 'forged-worker',
          p_status: 'failed',
          p_error_code: 'forged_failure'
        }
      );
      expect(ordinaryCompleteError).not.toBeNull();
      expect(ordinaryFinalizeError).not.toBeNull();
      await claimVersionAsService(harness.admin, uploaded.version_id);
      const { data: runningValidateJob } = await harness.admin
        .from('processing_jobs')
        .select('id')
        .eq('version_id', uploaded.version_id)
        .eq('status', 'running')
        .single();
      const { error: runningFinalizeError } = await harness.admin.rpc(
        'finalize_processing_version',
        {
          p_job_id: runningValidateJob?.id,
          p_worker_id: processingWorkerId(uploaded.version_id),
          p_status: 'searchable',
          p_error_code: null
        }
      );
      expect(runningFinalizeError?.message).toContain(
        'requires the finalize stage'
      );

      const completedJobId = await completeRunningJobAsService(
        harness.admin,
        uploaded.version_id,
        true
      );
      const { error: repeatedCompleteError } = await harness.admin.rpc(
        'complete_processing_stage',
        {
          p_job_id: completedJobId,
          p_worker_id: processingWorkerId(uploaded.version_id),
          p_next_stage: 'extract'
        }
      );
      expect(repeatedCompleteError?.message).toContain(
        'active processing lease not owned'
      );

      const { data: zeroChunkFinalizeJob } = await harness.admin
        .from('processing_jobs')
        .select('id')
        .eq('version_id', uploaded.version_id)
        .eq('stage', 'finalize')
        .single();
      const { error: zeroChunkFinalizeError } = await harness.admin.rpc(
        'finalize_processing_version',
        {
          p_job_id: zeroChunkFinalizeJob?.id,
          p_worker_id: processingWorkerId(uploaded.version_id),
          p_status: 'searchable',
          p_error_code: null
        }
      );
      expect(zeroChunkFinalizeError?.message).toContain(
        'requires content chunks'
      );

      const chunkId = await insertChunk(
        harness.admin,
        uploaded.version_id,
        'immutable-after-finalize'
      );
      const finalizedJobId = await publishVersionAsService(
        harness.admin,
        uploaded.version_id,
        'searchable'
      );

      const { error: repeatedFinalizeError } = await harness.admin.rpc(
        'finalize_processing_version',
        {
          p_job_id: finalizedJobId,
          p_worker_id: processingWorkerId(uploaded.version_id),
          p_status: 'searchable',
          p_error_code: null
        }
      );
      expect(repeatedFinalizeError?.message).toContain(
        'active processing lease not owned'
      );

      const { error: finalizedInsertError } = await harness.admin
        .from('content_chunks')
        .insert({
          version_id: uploaded.version_id,
          chunk_index: 1,
          content: 'late content',
          source_location: {
            schemaVersion: 1,
            kind: 'page',
            page: 2,
            label: '第 2 页'
          },
          search_tokens: [],
          embedding: Array.from({ length: 384 }, () => 0)
        });
      const { error: finalizedUpdateError } = await harness.admin
        .from('content_chunks')
        .update({ content: 'tampered' })
        .eq('id', chunkId);
      const { error: finalizedDeleteError } = await harness.admin
        .from('content_chunks')
        .delete()
        .eq('id', chunkId);
      expect(finalizedInsertError?.message).toContain(
        'content chunks may be written only'
      );
      expect(finalizedUpdateError?.message).toContain(
        'content chunks are frozen'
      );
      expect(finalizedDeleteError?.message).toContain(
        'content chunks are frozen'
      );

      const { error: backwardsError } = await harness.admin
        .from('file_versions')
        .update({ status: 'processing' })
        .eq('id', uploaded.version_id);
      const { error: terminalJobInsertError } = await harness.admin
        .from('processing_jobs')
        .insert({
          version_id: uploaded.version_id,
          stage: 'extract',
          status: 'succeeded'
        });
      const { error: directVersionDeleteError } = await harness.admin
        .from('file_versions')
        .delete()
        .eq('id', uploaded.version_id);
      expect(backwardsError).not.toBeNull();
      expect(terminalJobInsertError).not.toBeNull();
      expect(directVersionDeleteError).not.toBeNull();

      const { error: softDeleteError } = await actor.client.rpc(
        'soft_delete_file',
        { p_file_id: uploaded.file_id }
      );
      expect(softDeleteError).toBeNull();
      const { error: cleanupChunkDeleteError } = await harness.admin
        .from('content_chunks')
        .delete()
        .eq('id', chunkId);
      expect(cleanupChunkDeleteError).toBeNull();
    }));

  it('allows tracked workspace cascade cleanup without unlocking live chunk deletion', () =>
    runProcessingTest(async (harness) => {
      const actor = await harness.createActor('workspace-cascade');
      const workspaceId = await createWorkspace(actor.client, harness);
      const version = await createUploadedVersion(
        actor.client,
        workspaceId,
        'cascade-current'
      );
      await claimVersionAsService(harness.admin, version.version_id);
      const chunkId = await insertChunk(
        harness.admin,
        version.version_id,
        'cascade-cleanup'
      );
      await completeRunningJobAsService(
        harness.admin,
        version.version_id,
        true
      );
      await publishVersionAsService(
        harness.admin,
        version.version_id,
        'searchable'
      );

      const { error: liveDeleteError } = await harness.admin
        .from('content_chunks')
        .delete()
        .eq('id', chunkId);
      expect(liveDeleteError?.message).toContain('content chunks are frozen');

      const { error: cascadeError } = await harness.admin
        .from('workspaces')
        .delete()
        .eq('id', workspaceId);
      expect(cascadeError).toBeNull();
    }));

  it('claims one pending job only once under concurrency', () =>
    runProcessingTest(async (harness) => {
      const actor = await harness.createActor('concurrent-claim');
      const workspaceId = await createWorkspace(actor.client, harness);
      const version = await createUploadedVersion(
        actor.client,
        workspaceId,
        'one-job'
      );

      const claims = await Promise.all([
        harness.admin.rpc('claim_processing_job', {
          p_worker_id: 'concurrent-worker-a',
          p_lease_seconds: PROCESSING_LEASE_SECONDS
        }),
        harness.admin.rpc('claim_processing_job', {
          p_worker_id: 'concurrent-worker-b',
          p_lease_seconds: PROCESSING_LEASE_SECONDS
        })
      ]);
      expect(claims.map(({ error }) => error)).toEqual([null, null]);
      const claimedRows = claims.flatMap(({ data }) => data ?? []);
      expect(claimedRows).toHaveLength(1);
      expect(claimedRows[0]).toEqual(
        expect.objectContaining({
          version_id: version.version_id,
          attempt: 1
        })
      );
    }));

  it('bounds retries, rejects duplicate retry, and stores only error codes', () =>
    runProcessingTest(async (harness) => {
      const actor = await harness.createActor('retry-owner');
      const workspaceId = await createWorkspace(actor.client, harness);
      const version = await createUploadedVersion(
        actor.client,
        workspaceId,
        'retry'
      );
      const longErrorCode = `${'x'.repeat(120)}document body must not survive`;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await claimVersionAsService(harness.admin, version.version_id);
        const { data: jobs, error: jobsError } = await harness.admin
          .from('processing_jobs')
          .select('id, attempts')
          .eq('version_id', version.version_id)
          .single();
        if (jobsError) throw jobsError;
        expect(jobs.attempts).toBe(attempt);

        if (attempt === 1) {
          const { error: earlyFinalizeError } = await harness.admin.rpc(
            'finalize_processing_version',
            {
              p_job_id: jobs.id,
              p_worker_id: processingWorkerId(version.version_id),
              p_status: 'searchable',
              p_error_code: null
            }
          );
          expect(earlyFinalizeError?.message).toContain(
            'requires the finalize stage'
          );
        }

        const { error: completionError } = await harness.admin.rpc(
          'fail_processing_stage',
          {
            p_job_id: jobs.id,
            p_worker_id: processingWorkerId(version.version_id),
            p_error_code: longErrorCode,
            p_permanent: true
          }
        );
        expect(completionError).toBeNull();
        await assertVersionFailedByStageFailure(
          harness.admin,
          version.version_id
        );

        const { data: failedJob } = await harness.admin
          .from('processing_jobs')
          .select('error_code')
          .eq('id', jobs.id)
          .single();
        expect(failedJob?.error_code).toHaveLength(100);
        expect(failedJob?.error_code).not.toContain('document body');

        const { error: retryError } = await actor.client.rpc(
          'retry_file_version',
          { p_version_id: version.version_id }
        );
        if (attempt < 3) {
          expect(retryError).toBeNull();
          const { error: duplicateRetryError } = await actor.client.rpc(
            'retry_file_version',
            { p_version_id: version.version_id }
          );
          expect(duplicateRetryError?.message).toContain(
            'file version is not failed'
          );
        } else {
          expect(retryError?.message).toContain(
            'processing retry limit reached'
          );
        }
      }
      expect(await currentVersion(actor.client, version.file_id)).toBeNull();
      const { data: finalizeAudits, error: finalizeAuditError } =
        await actor.client
          .from('audit_events')
          .select('metadata')
          .eq('target_id', version.version_id)
          .eq('action', 'file_version.finalized');
      expect(finalizeAuditError).toBeNull();
      expect(finalizeAudits).not.toHaveLength(0);
      for (const event of finalizeAudits ?? []) {
        expect(JSON.stringify(event.metadata)).not.toContain('document body');
      }
    }));

  it('allows retry only for the uploader or an active workspace admin', () =>
    runProcessingTest(async (harness) => {
      const owner = await harness.createActor('retry-admin');
      const uploader = await harness.createActor('retry-uploader');
      const peer = await harness.createActor('retry-peer');
      const workspaceId = await createWorkspace(owner.client, harness);
      await addMember(harness, workspaceId, uploader);
      await addMember(harness, workspaceId, peer);
      const version = await createUploadedVersion(
        uploader.client,
        workspaceId,
        'retry-authority'
      );
      await claimVersionAsService(harness.admin, version.version_id);
      await completeRunningJobAsService(
        harness.admin,
        version.version_id,
        false,
        'extract_failed'
      );
      await assertVersionFailedByStageFailure(
        harness.admin,
        version.version_id
      );

      const { error: peerRetryError } = await peer.client.rpc(
        'retry_file_version',
        { p_version_id: version.version_id }
      );
      expect(peerRetryError?.message).toContain('file management required');

      const { error: removeUploaderError } = await owner.client.rpc(
        'remove_workspace_member',
        { p_workspace_id: workspaceId, p_user_id: uploader.userId }
      );
      expect(removeUploaderError).toBeNull();
      const { error: removedUploaderRetryError } = await uploader.client.rpc(
        'retry_file_version',
        { p_version_id: version.version_id }
      );
      expect(removedUploaderRetryError?.message).toContain(
        'file management required'
      );

      const { error: adminRetryError } = await owner.client.rpc(
        'retry_file_version',
        { p_version_id: version.version_id }
      );
      expect(adminRetryError).toBeNull();
    }));

  it('keeps audit append-only and device tokens user-owned', () =>
    runProcessingTest(async (harness) => {
      const owner = await harness.createActor('audit-owner');
      const member = await harness.createActor('audit-member');
      const workspaceId = await createWorkspace(owner.client, harness);
      await addMember(harness, workspaceId, member);

      const { data: memberAuditRows, error: memberAuditReadError } =
        await member.client
          .from('audit_events')
          .select('id')
          .eq('workspace_id', workspaceId);
      expect(memberAuditReadError).toBeNull();
      expect(memberAuditRows).toEqual([]);

      const { error: forgedAuditError } = await member.client
        .from('audit_events')
        .insert({
          workspace_id: workspaceId,
          actor_id: member.userId,
          action: 'forged',
          target_type: 'workspace',
          target_id: workspaceId
        });
      expect(forgedAuditError).not.toBeNull();

      const { data: ownerAuditRows, error: ownerAuditReadError } =
        await owner.client
          .from('audit_events')
          .select('id, action')
          .eq('workspace_id', workspaceId);
      expect(ownerAuditReadError).toBeNull();
      expect(ownerAuditRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'workspace.created' })
        ])
      );
      const auditId = ownerAuditRows?.[0]?.id;
      expect(auditId).toEqual(expect.any(String));
      const { error: auditUpdateError } = await owner.client
        .from('audit_events')
        .update({ action: 'tampered' })
        .eq('id', auditId);
      const { error: auditDeleteError } = await owner.client
        .from('audit_events')
        .delete()
        .eq('id', auditId);
      const { error: serviceAuditUpdateError } = await harness.admin
        .from('audit_events')
        .update({ action: 'service-tampered' })
        .eq('id', auditId);
      const { error: serviceAuditDeleteError } = await harness.admin
        .from('audit_events')
        .delete()
        .eq('id', auditId);
      expect(auditUpdateError).not.toBeNull();
      expect(auditDeleteError).not.toBeNull();
      expect(serviceAuditUpdateError).not.toBeNull();
      expect(serviceAuditDeleteError).not.toBeNull();

      const ownerTokens = ['owner-current-token', 'owner-other-token'];
      const { error: ownerDeviceError } = await owner.client
        .from('devices')
        .insert(
          ownerTokens.map((notification_token) => ({
            user_id: owner.userId,
            platform: 'macos',
            notification_token
          }))
        );
      if (ownerDeviceError) throw ownerDeviceError;
      const { data: memberDevice, error: memberDeviceError } =
        await member.client
          .from('devices')
          .insert({
            user_id: member.userId,
            platform: 'ios',
            notification_token: ownerTokens[0]
          })
          .select('id')
          .single();
      if (memberDeviceError) throw memberDeviceError;

      const { data: leakedDevices, error: leakedDeviceError } =
        await member.client
          .from('devices')
          .select('id')
          .eq('user_id', owner.userId);
      expect(leakedDeviceError).toBeNull();
      expect(leakedDevices).toEqual([]);

      const { data: crossUserUpdate, error: crossUserUpdateError } =
        await member.client
          .from('devices')
          .update({ notification_token: 'stolen-token' })
          .eq('user_id', owner.userId)
          .select('id');
      expect(crossUserUpdateError).toBeNull();
      expect(crossUserUpdate).toEqual([]);

      const { error: logoutError } = await owner.client
        .from('devices')
        .delete()
        .eq('notification_token', ownerTokens[0]);
      expect(logoutError).toBeNull();
      const { data: remainingOwnerDevices } = await owner.client
        .from('devices')
        .select('notification_token');
      expect(remainingOwnerDevices).toEqual([
        { notification_token: ownerTokens[1] }
      ]);
      const { data: memberDeviceAfterLogout } = await member.client
        .from('devices')
        .select('id')
        .eq('id', memberDevice.id);
      expect(memberDeviceAfterLogout).toEqual([{ id: memberDevice.id }]);
    }));
});
