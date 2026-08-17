import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createWorkspace,
  runWithCloudHarness,
  type CloudHarness,
  type TestActor
} from './testHarness';

interface PreparedUpload {
  outcome: 'created' | 'duplicate';
  file_id: string | null;
  version_id: string | null;
  storage_path: string | null;
  duplicate_file_id: string | null;
}

interface PreparedWebImport {
  file_id: string;
  version_id: string;
  storage_path: null;
}

type ProcessingStage =
  | 'validate'
  | 'extract'
  | 'chunk'
  | 'embed'
  | 'finalize';

interface ClaimedJob {
  job_id: string;
  version_id: string;
  stage: ProcessingStage;
}

const PROCESSING_LEASE_SECONDS = 120;

function checksum(): string {
  return `sha256:${randomUUID().replaceAll('-', '').padEnd(64, '0')}`;
}

function firstRow<T>(
  data: T[] | T | null,
  harness?: CloudHarness
): T | undefined {
  const row = Array.isArray(data) ? data[0] : (data ?? undefined);
  if (harness && row && typeof row === 'object') {
    const { file_id: fileId, version_id: versionId } = row as {
      file_id?: unknown;
      version_id?: unknown;
    };
    if (typeof fileId === 'string') harness.trackFile(fileId);
    if (typeof versionId === 'string') harness.trackFileVersion(versionId);
  }
  return row;
}

function processingWorkerId(versionId: string): string {
  return `phase1-cloud-${versionId}`;
}

function nextProcessingStage(
  stage: Exclude<ProcessingStage, 'finalize'>
): ProcessingStage {
  const nextStages: Record<Exclude<ProcessingStage, 'finalize'>, ProcessingStage> =
    {
      validate: 'extract',
      extract: 'chunk',
      chunk: 'embed',
      embed: 'finalize'
    };
  return nextStages[stage];
}

async function completeRunningJobAsService(
  admin: CloudHarness['admin'],
  versionId: string
): Promise<string> {
  const { data: initialJob, error: jobError } = await admin
    .from('processing_jobs')
    .select('id, version_id, stage')
    .eq('version_id', versionId)
    .eq('status', 'running')
    .single();
  if (jobError) throw jobError;

  let runningJob = initialJob as unknown as ClaimedJob;
  while (runningJob.stage !== 'finalize') {
    const nextStage = nextProcessingStage(runningJob.stage);
    const { error: completionError } = await admin.rpc(
      'complete_processing_stage',
      {
        p_job_id: runningJob.job_id,
        p_worker_id: processingWorkerId(versionId),
        p_next_stage: nextStage
      }
    );
    if (completionError) {
      throw new Error(
        `complete_processing_stage(${runningJob.stage} -> ${nextStage}): ${completionError.message}`
      );
    }

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
    runningJob = claimed;
  }

  const { error } = await admin.rpc('finalize_processing_version', {
    p_job_id: runningJob.job_id,
    p_worker_id: processingWorkerId(versionId),
    p_status: 'searchable',
    p_error_code: null
  });
  if (error) {
    throw new Error(`finalize_processing_version: ${error.message}`);
  }
  return initialJob.id as string;
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

async function runFileTest(
  run: (
    harness: CloudHarness,
    trackObject: (path: string) => void
  ) => Promise<void>
): Promise<void> {
  await runWithCloudHarness(async (harness) => {
    await run(harness, (path) => harness.trackStoragePath(path));
  });
}

describe('private file Storage contracts', () => {
  // This deterministic matrix is the combined `pnpm test:cloud` gate's
  // actor/workspace case; other cases focus on one lifecycle edge each.
  it('covers the combined gate actor matrix and generated team path', () =>
    runFileTest(async (harness, trackObject) => {
      const ownerA = await harness.createActor('storage-owner-a');
      const memberA = await harness.createActor('storage-member-a');
      const adminB = await harness.createActor('storage-admin-b');
      const outsider = await harness.createActor('storage-outsider');
      const workspaceA = await createWorkspace(ownerA.client, harness, '团队 A');
      const workspaceB = await createWorkspace(
        adminB.client,
        harness,
        '团队 B'
      );
      await addMember(harness, workspaceA, memberA);
      await addMember(harness, workspaceB, ownerA);

      const { data: ownerWorkspaceRows, error: ownerWorkspaceError } =
        await ownerA.client.from('workspaces').select('id').order('id');
      expect(ownerWorkspaceError).toBeNull();
      expect(ownerWorkspaceRows?.map(({ id }) => id).sort()).toEqual(
        [workspaceA, workspaceB].sort()
      );
      const { data: adminBWorkspaceRows, error: adminBWorkspaceError } =
        await adminB.client.from('workspaces').select('id');
      expect(adminBWorkspaceError).toBeNull();
      expect(adminBWorkspaceRows).toEqual([{ id: workspaceB }]);
      const { data: outsiderWorkspaceRows, error: outsiderWorkspaceError } =
        await outsider.client.from('workspaces').select('id');
      expect(outsiderWorkspaceError).toBeNull();
      expect(outsiderWorkspaceRows).toEqual([]);

      const { data: prepared, error: prepareError } = await memberA.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceA,
          p_display_name: '报价.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(prepareError).toBeNull();
      const preparedRow = firstRow(
        prepared,
        harness
      ) as PreparedUpload | undefined;
      expect(preparedRow?.outcome).toBe('created');
      expect(preparedRow?.storage_path).toBe(
        `${workspaceA}/${preparedRow?.file_id}/${preparedRow?.version_id}/source.pdf`
      );
      trackObject(preparedRow!.storage_path!);

      const { data: signedUpload, error: signError } =
        await memberA.client.storage
          .from('documents')
          .createSignedUploadUrl(preparedRow!.storage_path!, {
            upsert: false
          });
      expect(signError).toBeNull();
      expect(signedUpload?.token).toEqual(expect.any(String));

      const { error: uploadError } = await memberA.client.storage
        .from('documents')
        .uploadToSignedUrl(
          preparedRow!.storage_path!,
          signedUpload!.token,
          new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }),
          { contentType: 'application/pdf', upsert: false }
        );
      expect(uploadError).toBeNull();

      const { error: completionError } = await memberA.client.rpc(
        'mark_upload_complete',
        { p_version_id: preparedRow!.version_id }
      );
      expect(completionError).toBeNull();

      const { data: memberFiles, error: memberFilesError } =
        await memberA.client
          .from('files')
          .select('id, current_version_id')
          .eq('id', preparedRow!.file_id);
      const { data: memberVersions, error: memberVersionsError } =
        await memberA.client
          .from('file_versions')
          .select('id, status')
          .eq('id', preparedRow!.version_id);
      const { data: memberJobs, error: memberJobsError } =
        await memberA.client
          .from('processing_jobs')
          .select('version_id, status')
          .eq('version_id', preparedRow!.version_id);
      expect(memberFilesError).toBeNull();
      expect(memberVersionsError).toBeNull();
      expect(memberJobsError).toBeNull();
      expect(memberFiles).toEqual([
        { id: preparedRow!.file_id, current_version_id: null }
      ]);
      expect(memberVersions).toEqual([
        { id: preparedRow!.version_id, status: 'pending_processing' }
      ]);
      expect(memberJobs).toEqual([
        { version_id: preparedRow!.version_id, status: 'pending' }
      ]);

      const { error: directMembershipError } = await memberA.client
        .from('memberships')
        .update({ role: 'admin' })
        .eq('workspace_id', workspaceA)
        .eq('user_id', memberA.userId);
      const { error: directInvitationError } = await memberA.client
        .from('workspace_invitations')
        .insert({
          workspace_id: workspaceA,
          email: outsider.email,
          invited_by: memberA.userId,
          expires_at: new Date(Date.now() + 60_000).toISOString()
        });
      const { error: directFileError } = await memberA.client
        .from('files')
        .update({ display_name: '绕过 RPC.pdf' })
        .eq('id', preparedRow!.file_id);
      const { error: directVersionError } = await memberA.client
        .from('file_versions')
        .update({ error_code: 'forged' })
        .eq('id', preparedRow!.version_id);
      const { error: directJobError } = await memberA.client
        .from('processing_jobs')
        .update({ error_code: 'forged' })
        .eq('version_id', preparedRow!.version_id);
      const { error: directChunkError } = await memberA.client
        .from('content_chunks')
        .insert({
          version_id: preparedRow!.version_id,
          content: 'forged',
          source_location: { page: 1 },
          embedding: Array.from({ length: 384 }, () => 0)
        });
      const { error: directAuditError } = await memberA.client
        .from('audit_events')
        .insert({
          workspace_id: workspaceA,
          actor_id: memberA.userId,
          action: 'forged',
          target_type: 'file',
          target_id: preparedRow!.file_id
        });
      for (const directWriteError of [
        directMembershipError,
        directInvitationError,
        directFileError,
        directVersionError,
        directJobError,
        directChunkError,
        directAuditError
      ]) {
        expect(directWriteError).not.toBeNull();
      }

      const { error: chunkFixtureError } = await harness.admin
        .from('content_chunks')
        .insert({
          version_id: preparedRow!.version_id,
          content: 'workspace-a-search-fixture',
          source_location: { page: 1 },
          embedding: Array.from({ length: 384 }, () => 0)
      });
      if (chunkFixtureError) throw chunkFixtureError;
      await completeRunningJobAsService(harness.admin, preparedRow!.version_id!);

      for (const actor of [ownerA, memberA]) {
        const { data: files, error: filesError } = await actor.client
          .from('files')
          .select('id, current_version_id')
          .eq('id', preparedRow!.file_id);
        const { data: versions, error: versionsError } = await actor.client
          .from('file_versions')
          .select('id, status')
          .eq('id', preparedRow!.version_id);
        const { data: chunks, error: chunksError } = await actor.client
          .from('content_chunks')
          .select('content')
          .eq('version_id', preparedRow!.version_id);
        expect(filesError).toBeNull();
        expect(versionsError).toBeNull();
        expect(chunksError).toBeNull();
        expect(files).toEqual([
          {
            id: preparedRow!.file_id,
            current_version_id: preparedRow!.version_id
          }
        ]);
        expect(versions).toEqual([
          { id: preparedRow!.version_id, status: 'searchable' }
        ]);
        expect(chunks).toEqual([{ content: 'workspace-a-search-fixture' }]);
      }

      for (const actor of [adminB, outsider]) {
        const { data: files, error: filesError } = await actor.client
          .from('files')
          .select('id')
          .eq('id', preparedRow!.file_id);
        const { data: versions, error: versionsError } = await actor.client
          .from('file_versions')
          .select('id')
          .eq('id', preparedRow!.version_id);
        const { data: chunks, error: chunksError } = await actor.client
          .from('content_chunks')
          .select('id')
          .eq('version_id', preparedRow!.version_id);
        expect(filesError).toBeNull();
        expect(versionsError).toBeNull();
        expect(chunksError).toBeNull();
        expect(files).toEqual([]);
        expect(versions).toEqual([]);
        expect(chunks).toEqual([]);
      }

      const { data: memberUrl, error: memberUrlError } =
        await memberA.client.storage
          .from('documents')
          .createSignedUrl(preparedRow!.storage_path!, 60);
      expect(memberUrlError).toBeNull();
      expect(memberUrl?.signedUrl).toEqual(expect.any(String));

      const { data: outsiderUrl } = await outsider.client.storage
        .from('documents')
        .createSignedUrl(preparedRow!.storage_path!, 60);
      expect(outsiderUrl).toBeNull();

      const { data: adminBUrl } = await adminB.client.storage
        .from('documents')
        .createSignedUrl(preparedRow!.storage_path!, 60);
      expect(adminBUrl).toBeNull();

      const { error: crossTeamVersionError } = await adminB.client.rpc(
        'prepare_file_version_upload',
        {
          p_file_id: preparedRow!.file_id,
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      const { error: crossTeamDeleteError } = await adminB.client.rpc(
        'soft_delete_file',
        { p_file_id: preparedRow!.file_id }
      );
      expect(crossTeamVersionError?.message).toContain(
        'file management required'
      );
      expect(crossTeamDeleteError?.message).toContain(
        'file management required'
      );

      const { data: crossTeamUpload, error: crossTeamUploadError } =
        await adminB.client.storage
          .from('documents')
          .createSignedUploadUrl(preparedRow!.storage_path!, {
            upsert: false
          });
      expect(crossTeamUpload).toBeNull();
      expect(crossTeamUploadError).not.toBeNull();

      const { error: crossTeamPrepareError } = await memberA.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceB,
          p_display_name: '越权.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(crossTeamPrepareError?.message).toContain(
        'workspace membership required'
      );

      const { error: deviceFixtureError } = await memberA.client
        .from('devices')
        .insert({
          user_id: memberA.userId,
          platform: 'ios',
          notification_token: `removed-${harness.runId}`
        });
      if (deviceFixtureError) throw deviceFixtureError;
      const { error: removeMemberError } = await ownerA.client.rpc(
        'remove_workspace_member',
        { p_workspace_id: workspaceA, p_user_id: memberA.userId }
      );
      expect(removeMemberError).toBeNull();

      const removedSessionReads = await Promise.all([
        memberA.client.from('workspaces').select('id').eq('id', workspaceA),
        memberA.client
          .from('memberships')
          .select('workspace_id')
          .eq('workspace_id', workspaceA),
        memberA.client
          .from('files')
          .select('id')
          .eq('workspace_id', workspaceA),
        memberA.client
          .from('file_versions')
          .select('id')
          .eq('workspace_id', workspaceA),
        memberA.client.from('processing_jobs').select('id'),
        memberA.client.from('content_chunks').select('id')
      ]);
      for (const { data, error } of removedSessionReads) {
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
      const { data: retainedDevice, error: retainedDeviceError } =
        await memberA.client
          .from('devices')
          .select('notification_token')
          .eq('notification_token', `removed-${harness.runId}`);
      expect(retainedDeviceError).toBeNull();
      expect(retainedDevice).toEqual([
        { notification_token: `removed-${harness.runId}` }
      ]);
      const { error: removedUploadError } = await memberA.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceA,
          p_display_name: '已移除.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(removedUploadError?.message).toContain(
        'workspace membership required'
      );
      const { data: removedDownload } = await memberA.client.storage
        .from('documents')
        .createSignedUrl(preparedRow!.storage_path!, 60);
      expect(removedDownload).toBeNull();
      const { data: removedUpload, error: removedUploadSignError } =
        await memberA.client.storage
          .from('documents')
          .createSignedUploadUrl(preparedRow!.storage_path!, {
            upsert: false
          });
      expect(removedUpload).toBeNull();
      expect(removedUploadSignError).not.toBeNull();

      for (const table of [
        'workspaces',
        'memberships',
        'workspace_invitations',
        'files',
        'file_versions',
        'processing_jobs',
        'content_chunks',
        'devices',
        'audit_events',
        'spike_chunks'
      ]) {
        const { error } = await harness.anon.from(table).select('*').limit(1);
        expect(error).not.toBeNull();
      }

      const attackerPath = `${workspaceB}/${randomUUID()}/${randomUUID()}/source.pdf`;
      const { data: attackerSignedUpload, error: attackerSignError } =
        await memberA.client.storage
          .from('documents')
          .createSignedUploadUrl(attackerPath, { upsert: false });
      expect(attackerSignedUpload).toBeNull();
      expect(attackerSignError).not.toBeNull();

      for (const malformedPath of [
        'not-a-uuid/file/version/source.pdf',
        'https:/not-a-storage-path',
        '../source.pdf',
        `${workspaceA.slice(0, -1)}z/${randomUUID()}/${randomUUID()}/source.pdf`
      ]) {
        const { data: malformedData, error: malformedError } =
          await memberA.client.storage
            .from('documents')
            .createSignedUploadUrl(malformedPath, { upsert: false });
        expect(malformedData).toBeNull();
        expect(malformedError).not.toBeNull();
      }
    }));

  it('leaves status and jobs untouched when the prepared object is missing', () =>
    runFileTest(async (harness) => {
      const owner = await harness.createActor('missing-object-owner');
      const workspaceId = await createWorkspace(owner.client, harness);
      const { data, error: prepareError } = await owner.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceId,
          p_display_name: '尚未上传.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(prepareError).toBeNull();
      const prepared = firstRow(data, harness) as PreparedUpload;

      const { error: completionError } = await owner.client.rpc(
        'mark_upload_complete',
        { p_version_id: prepared.version_id }
      );
      expect(completionError?.message).toContain('uploaded object not found');

      const { data: version, error: versionError } = await owner.client
        .from('file_versions')
        .select('status')
        .eq('id', prepared.version_id)
        .single();
      expect(versionError).toBeNull();
      expect(version?.status).toBe('awaiting_upload');

      const { data: jobs, error: jobsError } = await owner.client
        .from('processing_jobs')
        .select('id, stage')
        .eq('version_id', prepared.version_id);
      expect(jobsError).toBeNull();
      expect(jobs).toEqual([]);
    }));

  it('allows only the uploader or admin to complete an existing object', () =>
    runFileTest(async (harness, trackObject) => {
      const owner = await harness.createActor('completion-owner');
      const uploader = await harness.createActor('completion-uploader');
      const peer = await harness.createActor('completion-peer');
      const workspaceId = await createWorkspace(owner.client, harness);
      await addMember(harness, workspaceId, uploader);
      await addMember(harness, workspaceId, peer);

      const { data, error: prepareError } = await uploader.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceId,
          p_display_name: '待完成.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(prepareError).toBeNull();
      const prepared = firstRow(data, harness) as PreparedUpload;

      const { error: peerCompletionError } = await peer.client.rpc(
        'mark_upload_complete',
        { p_version_id: prepared.version_id }
      );
      expect(peerCompletionError?.message).toContain(
        'upload completion authority required'
      );

      const objectPath = prepared.storage_path!;
      trackObject(objectPath);
      const { error: fixtureUploadError } = await harness.admin.storage
        .from('documents')
        .upload(
          objectPath,
          new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }),
          { contentType: 'application/pdf', upsert: false }
        );
      if (fixtureUploadError) throw fixtureUploadError;

      const { error: adminCompletionError } = await owner.client.rpc(
        'mark_upload_complete',
        { p_version_id: prepared.version_id }
      );
      expect(adminCompletionError).toBeNull();

      const { data: completedVersion, error: completedVersionError } =
        await owner.client
          .from('file_versions')
          .select('status')
          .eq('id', prepared.version_id)
          .single();
      expect(completedVersionError).toBeNull();
      expect(completedVersion?.status).toBe('pending_processing');

      const { data: jobs, error: jobsError } = await owner.client
        .from('processing_jobs')
        .select('stage, status')
        .eq('version_id', prepared.version_id);
      expect(jobsError).toBeNull();
      expect(jobs).toEqual([{ stage: 'validate', status: 'pending' }]);

      const { error: removeError } = await owner.client.rpc(
        'remove_workspace_member',
        { p_workspace_id: workspaceId, p_user_id: uploader.userId }
      );
      expect(removeError).toBeNull();

      const { data: removedMemberUrl, error: removedMemberUrlError } =
        await uploader.client.storage
          .from('documents')
          .createSignedUrl(objectPath, 60);
      expect(removedMemberUrl).toBeNull();
      expect(removedMemberUrlError).not.toBeNull();

      const { data: adminUrl, error: adminUrlError } =
        await owner.client.storage
          .from('documents')
          .createSignedUrl(objectPath, 60);
      expect(adminUrlError).toBeNull();
      expect(adminUrl?.signedUrl).toEqual(expect.any(String));
    }));

  it('deduplicates active checksums without overwriting or switching versions', () =>
    runFileTest(async (harness, trackObject) => {
      const owner = await harness.createActor('duplicate-owner');
      const member = await harness.createActor('duplicate-member');
      const workspaceId = await createWorkspace(owner.client, harness);
      await addMember(harness, workspaceId, member);
      const firstChecksum = checksum();

      const { data: firstData, error: firstError } = await member.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceId,
          p_display_name: '同名.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 100000000,
          p_checksum: firstChecksum
        }
      );
      expect(firstError).toBeNull();
      const first = firstRow(firstData, harness) as PreparedUpload;
      expect(first.outcome).toBe('created');

      const { data: duplicateData, error: duplicateError } =
        await member.client.rpc('prepare_file_upload', {
          p_workspace_id: workspaceId,
          p_display_name: '改名后.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 999,
          p_checksum: firstChecksum
        });
      expect(duplicateError).toBeNull();
      expect(firstRow(duplicateData)).toEqual({
        outcome: 'duplicate',
        file_id: null,
        version_id: null,
        storage_path: null,
        duplicate_file_id: first.file_id
      });
      const { count: fileCountAfterDuplicate, error: fileCountError } =
        await member.client
          .from('files')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId);
      const {
        count: versionCountAfterDuplicate,
        error: versionCountError
      } = await member.client
        .from('file_versions')
        .select('*', { count: 'exact', head: true })
        .eq('file_id', first.file_id);
      expect(fileCountError).toBeNull();
      expect(versionCountError).toBeNull();
      expect(fileCountAfterDuplicate).toBe(1);
      expect(versionCountAfterDuplicate).toBe(1);

      const { data: sameNameData, error: sameNameError } =
        await member.client.rpc('prepare_file_upload', {
          p_workspace_id: workspaceId,
          p_display_name: '同名.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        });
      expect(sameNameError).toBeNull();
      const sameName = firstRow(sameNameData, harness) as PreparedUpload;
      expect(sameName.outcome).toBe('created');
      expect(sameName.file_id).not.toBe(first.file_id);

      trackObject(first.storage_path!);
      const { data: signedUpload, error: signedUploadError } =
        await member.client.storage
          .from('documents')
          .createSignedUploadUrl(first.storage_path!, { upsert: false });
      if (signedUploadError || !signedUpload?.token) {
        throw (
          signedUploadError ?? new Error('signed upload token was not returned')
        );
      }
      const { error: fixtureUploadError } = await member.client.storage
        .from('documents')
        .uploadToSignedUrl(
          first.storage_path!,
          signedUpload.token,
          new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }),
          { contentType: 'application/pdf', upsert: false }
        );
      if (fixtureUploadError) throw fixtureUploadError;
      const { error: markCompleteError } = await member.client.rpc(
        'mark_upload_complete',
        { p_version_id: first.version_id }
      );
      if (markCompleteError) throw markCompleteError;
      const { error: chunkFixtureError } = await harness.admin
        .from('content_chunks')
        .insert({
          version_id: first.version_id,
          content: 'synthetic searchable fixture',
          source_location: { page: 1 },
          embedding: Array.from({ length: 384 }, () => 0)
      });
      if (chunkFixtureError) throw chunkFixtureError;
      await completeRunningJobAsService(harness.admin, first.version_id!);

      const { data: versionDuplicateData, error: versionDuplicateError } =
        await member.client.rpc('prepare_file_version_upload', {
          p_file_id: first.file_id,
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: firstChecksum
        });
      expect(versionDuplicateError).toBeNull();
      expect(firstRow(versionDuplicateData)).toEqual(
        expect.objectContaining({
          outcome: 'duplicate',
          duplicate_file_id: first.file_id,
          version_id: null
        })
      );
      const {
        count: versionCountAfterVersionDuplicate,
        error: versionCountAfterVersionDuplicateError
      } = await member.client
        .from('file_versions')
        .select('*', { count: 'exact', head: true })
        .eq('file_id', first.file_id);
      expect(versionCountAfterVersionDuplicateError).toBeNull();
      expect(versionCountAfterVersionDuplicate).toBe(1);

      const { error: invalidVersionError } = await member.client.rpc(
        'prepare_file_version_upload',
        {
          p_file_id: first.file_id,
          p_mime_type: 'application/pdf',
          p_size_bytes: 100000001,
          p_checksum: checksum()
        }
      );
      expect(invalidVersionError?.message).toContain(
        'file size must be between 1 and 100000000 bytes'
      );

      const { data: fileAfterFailure, error: currentVersionReadError } =
        await member.client
          .from('files')
          .select('current_version_id')
          .eq('id', first.file_id)
          .single();
      expect(currentVersionReadError).toBeNull();
      expect(fileAfterFailure?.current_version_id).toBe(first.version_id);

      const { data: newVersionData, error: newVersionError } =
        await member.client.rpc('prepare_file_version_upload', {
          p_file_id: first.file_id,
          p_mime_type: 'image/png',
          p_size_bytes: 12,
          p_checksum: checksum()
        });
      expect(newVersionError).toBeNull();
      const newVersion = firstRow(newVersionData, harness) as PreparedUpload;
      expect(newVersion.outcome).toBe('created');
      expect(newVersion.file_id).toBe(first.file_id);
      expect(newVersion.storage_path).toBe(
        `${workspaceId}/${first.file_id}/${newVersion.version_id}/source.png`
      );

      const { data: fileAfterPreparation } = await member.client
        .from('files')
        .select('current_version_id')
        .eq('id', first.file_id)
        .single();
      expect(fileAfterPreparation?.current_version_id).toBe(first.version_id);
    }));

  it.each([
    ['application/msword', 'doc'],
    ['application/vnd.ms-powerpoint', 'ppt'],
    ['application/vnd.ms-excel', 'xls']
  ])('rejects unsupported legacy Office MIME %s (%s)', (mimeType) =>
    runFileTest(async (harness) => {
      const owner = await harness.createActor('legacy-office-owner');
      const workspaceId = await createWorkspace(owner.client, harness);
      const { error } = await owner.client.rpc('prepare_file_upload', {
        p_workspace_id: workspaceId,
        p_display_name: '旧版文档',
        p_mime_type: mimeType,
        p_size_bytes: 12,
        p_checksum: checksum()
      });
      expect(error?.message).toContain('unsupported MIME type');
    }));

  it.each([
    ['application/pdf', 'pdf'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'docx'
    ],
    [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'pptx'
    ],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xlsx'
    ],
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/heic', 'heic'],
    ['image/heif', 'heic']
  ])('binds supported MIME %s to generated .%s paths', (mimeType, extension) =>
    runFileTest(async (harness) => {
      const owner = await harness.createActor(`supported-${extension}`);
      const workspaceId = await createWorkspace(owner.client, harness);
      const { data, error } = await owner.client.rpc('prepare_file_upload', {
        p_workspace_id: workspaceId,
        p_display_name: `样本.${extension}`,
        p_mime_type: mimeType,
        p_size_bytes: 1,
        p_checksum: checksum()
      });
      expect(error).toBeNull();
      const prepared = firstRow(data, harness) as PreparedUpload;
      expect(prepared.storage_path).toBe(
        `${workspaceId}/${prepared.file_id}/${prepared.version_id}/source.${extension}`
      );
    }));

  it('rejects non-lowercase or malformed checksums before creating rows', () =>
    runFileTest(async (harness) => {
      const owner = await harness.createActor('invalid-checksum-owner');
      const workspaceId = await createWorkspace(owner.client, harness);
      const { error } = await owner.client.rpc('prepare_file_upload', {
        p_workspace_id: workspaceId,
        p_display_name: '校验值.pdf',
        p_mime_type: 'application/pdf',
        p_size_bytes: 12,
        p_checksum: `sha256:${'A'.repeat(64)}`
      });
      expect(error?.message).toContain(
        'checksum must use lowercase sha256 format'
      );

      const { count, error: countError } = await owner.client
        .from('files')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);
      expect(countError).toBeNull();
      expect(count).toBe(0);
    }));

  it('stores HTTPS web imports as URL snapshots without a Storage path', () =>
    runFileTest(async (harness) => {
      const owner = await harness.createActor('web-owner');
      const workspaceId = await createWorkspace(owner.client, harness);

      const { data, error } = await owner.client.rpc('prepare_web_import', {
        p_workspace_id: workspaceId,
        p_display_name: ' 入门指南 ',
        p_original_url: 'https://example.com/paywall/article?from=share'
      });
      expect(error).toBeNull();
      const prepared = firstRow(data, harness) as PreparedWebImport;
      expect(prepared.storage_path).toBeNull();
      const webObjectPrefix = `${workspaceId}/${prepared.file_id}/${prepared.version_id}`;
      const { data: webObjects, error: webObjectsError } =
        await harness.admin.storage
          .from('documents')
          .list(webObjectPrefix, { limit: 1 });
      expect(webObjectsError).toBeNull();
      expect(webObjects).toEqual([]);

      const { data: file, error: fileError } = await owner.client
        .from('files')
        .select('display_name, source_type, current_version_id')
        .eq('id', prepared.file_id)
        .single();
      expect(fileError).toBeNull();
      expect(file).toEqual({
        display_name: '入门指南',
        source_type: 'web',
        current_version_id: null
      });

      const { data: version, error: versionError } = await owner.client
        .from('file_versions')
        .select(
          'original_url, storage_path, checksum, mime_type, size_bytes, status'
        )
        .eq('id', prepared.version_id)
        .single();
      expect(versionError).toBeNull();
      expect(version).toEqual({
        original_url: 'https://example.com/paywall/article?from=share',
        storage_path: null,
        checksum: null,
        mime_type: 'text/html',
        size_bytes: null,
        status: 'pending_processing'
      });

      const { data: jobs, error: jobsError } = await owner.client
        .from('processing_jobs')
        .select('stage, status')
        .eq('version_id', prepared.version_id);
      expect(jobsError).toBeNull();
      expect(jobs).toEqual([{ stage: 'validate', status: 'pending' }]);

      const { error: httpError } = await owner.client.rpc(
        'prepare_web_import',
        {
          p_workspace_id: workspaceId,
          p_display_name: '不安全链接',
          p_original_url: 'http://example.com/article'
        }
      );
      expect(httpError?.message).toContain('absolute https URL required');

      for (const validUrl of [
        'https://example.com',
        'https://docs.example.com:443/path?q=1#section',
        'https://192.0.2.1:8443/article',
        'https://[2001:db8::1]:443/article'
      ]) {
        const { data: validUrlData, error: validUrlError } = await owner.client.rpc(
          'prepare_web_import',
          {
            p_workspace_id: workspaceId,
            p_display_name: '合法链接',
            p_original_url: validUrl
          }
        );
        expect(validUrlError).toBeNull();
        firstRow(validUrlData, harness);
      }

      for (const invalidUrl of [
        'https://:',
        'https://@',
        'https://user@example.com/article',
        'https://-',
        'https://example..com/article',
        'https://999.999.999.999/article',
        'https://example.com:abc/article',
        'https://example.com:0/article',
        'https://example.com:65536/article',
        'https://[not-an-ip]/article'
      ]) {
        const { error: invalidUrlError } = await owner.client.rpc(
          'prepare_web_import',
          {
            p_workspace_id: workspaceId,
            p_display_name: '非法链接',
            p_original_url: invalidUrl
          }
        );
        expect(invalidUrlError?.message).toContain(
          'absolute https URL required'
        );
      }
    }));

  it('enforces uploader-or-admin management and immediate removal loss', () =>
    runFileTest(async (harness) => {
      const owner = await harness.createActor('ownership-owner');
      const uploader = await harness.createActor('ownership-uploader');
      const peer = await harness.createActor('ownership-peer');
      const workspaceId = await createWorkspace(owner.client, harness);
      await addMember(harness, workspaceId, uploader);
      await addMember(harness, workspaceId, peer);

      const { data, error } = await uploader.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceId,
          p_display_name: '团队资料.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(error).toBeNull();
      const prepared = firstRow(data, harness) as PreparedUpload;

      const { error: peerVersionError } = await peer.client.rpc(
        'prepare_file_version_upload',
        {
          p_file_id: prepared.file_id,
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(peerVersionError?.message).toContain('file management required');

      const { error: peerDeleteError } = await peer.client.rpc(
        'soft_delete_file',
        { p_file_id: prepared.file_id }
      );
      expect(peerDeleteError?.message).toContain('file management required');

      const { data: adminVersionData, error: adminVersionError } =
        await owner.client.rpc('prepare_file_version_upload', {
          p_file_id: prepared.file_id,
          p_mime_type: 'application/pdf',
          p_size_bytes: 13,
          p_checksum: checksum()
        });
      expect(adminVersionError).toBeNull();
      expect(firstRow(adminVersionData, harness)).toEqual(
        expect.objectContaining({ outcome: 'created' })
      );

      const { error: removeError } = await owner.client.rpc(
        'remove_workspace_member',
        { p_workspace_id: workspaceId, p_user_id: uploader.userId }
      );
      expect(removeError).toBeNull();

      const { error: removedPrepareError } = await uploader.client.rpc(
        'prepare_file_upload',
        {
          p_workspace_id: workspaceId,
          p_display_name: '移除后.pdf',
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(removedPrepareError?.message).toContain(
        'workspace membership required'
      );

      const { error: removedVersionError } = await uploader.client.rpc(
        'prepare_file_version_upload',
        {
          p_file_id: prepared.file_id,
          p_mime_type: 'application/pdf',
          p_size_bytes: 12,
          p_checksum: checksum()
        }
      );
      expect(removedVersionError?.message).toContain(
        'file management required'
      );

      const { error: adminDeleteError } = await owner.client.rpc(
        'soft_delete_file',
        { p_file_id: prepared.file_id }
      );
      expect(adminDeleteError).toBeNull();

      const { error: repeatedDeleteError } = await owner.client.rpc(
        'soft_delete_file',
        { p_file_id: prepared.file_id }
      );
      expect(repeatedDeleteError?.message).toContain(
        'file has already been deleted'
      );

      const { data: hiddenFiles, error: hiddenFilesError } =
        await owner.client
          .from('files')
          .select('id')
          .eq('id', prepared.file_id);
      expect(hiddenFilesError).toBeNull();
      expect(hiddenFiles).toEqual([]);

      const { data: storedFile, error: storedFileError } = await harness.admin
        .from('files')
        .select('uploader_id, deleted_at, deleted_by')
        .eq('id', prepared.file_id)
        .single();
      expect(storedFileError).toBeNull();
      expect(storedFile).toEqual({
        uploader_id: uploader.userId,
        deleted_at: expect.any(String),
        deleted_by: owner.userId
      });

      const { data: versions, error: versionsError } = await harness.admin
        .from('file_versions')
        .select('id')
        .eq('file_id', prepared.file_id);
      if (versionsError) throw versionsError;
      const { data: cleanupJobs, error: cleanupJobsError } =
        await harness.admin
          .from('processing_jobs')
          .select('version_id, stage, status')
          .in(
            'version_id',
            (versions ?? []).map(({ id }) => id)
          )
          .eq('stage', 'cleanup');
      expect(cleanupJobsError).toBeNull();
      expect(cleanupJobs).toHaveLength(versions?.length ?? 0);
      expect(cleanupJobs).toEqual(
        expect.arrayContaining(
          (versions ?? []).map(({ id }) => ({
            version_id: id,
            stage: 'cleanup',
            status: 'pending'
          }))
        )
      );
    }));
});
