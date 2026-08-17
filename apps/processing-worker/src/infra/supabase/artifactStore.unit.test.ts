import { expect, it } from 'vitest';

import { ProcessingFailure } from '../../core/errors';
import { createArtifactStore } from './artifactStore';

const workspaceId = '40000000-0000-4000-8000-000000000004';
const versionId = '20000000-0000-4000-8000-000000000002';

function fakeClient() {
  const calls: Array<{ operation: string; path: unknown; options?: unknown }> = [];
  const bucket = {
    upload: async (path: string, bytes: Uint8Array, options: unknown) => {
      calls.push({ operation: 'upload', path, options });
      return { data: { path }, error: null, bytes };
    },
    download: async (path: string) => {
      calls.push({ operation: 'download', path });
      return { data: new Blob([Uint8Array.from([1, 2, 3])]), error: null };
    },
    remove: async (paths: string[]) => {
      calls.push({ operation: 'remove', path: paths });
      return { data: paths.map((name) => ({ name })), error: null };
    }
  };
  return {
    client: { storage: { from: () => bucket } },
    calls
  };
}

it('writes and reads the exact version-scoped gzip artifact path', async () => {
  const fake = fakeClient();
  const store = createArtifactStore(fake.client);
  const signal = new AbortController().signal;

  await store.write(workspaceId, versionId, 'normalized', Uint8Array.from([9]), signal);
  await expect(store.read(workspaceId, versionId, 'chunks', signal))
    .resolves.toEqual(Uint8Array.from([1, 2, 3]));

  expect(fake.calls).toEqual([
    {
      operation: 'upload',
      path: `processing/${workspaceId}/${versionId}/normalized-v1.json.gz`,
      options: { contentType: 'application/gzip', upsert: true }
    },
    {
      operation: 'download',
      path: `processing/${workspaceId}/${versionId}/chunks-v1.json.gz`
    }
  ]);
});

it('deletes only the two exact artifacts below a validated version prefix', async () => {
  const fake = fakeClient();
  const store = createArtifactStore(fake.client);

  await store.deleteVersion(workspaceId, versionId, new AbortController().signal);

  expect(fake.calls).toEqual([{
    operation: 'remove',
    path: [
      `processing/${workspaceId}/${versionId}/normalized-v1.json.gz`,
      `processing/${workspaceId}/${versionId}/chunks-v1.json.gz`
    ]
  }]);
});

it.each([
  ['workspace traversal', '../workspace', versionId],
  ['version traversal', workspaceId, '../version'],
  ['workspace-level deletion', workspaceId, '']
])('rejects %s before any storage request', async (_name, workspace, version) => {
  const fake = fakeClient();
  const store = createArtifactStore(fake.client);

  const error = await store.deleteVersion(
    workspace,
    version,
    new AbortController().signal
  ).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(ProcessingFailure);
  expect(error).toMatchObject({ code: 'artifact_io_failed' });
  expect(fake.calls).toEqual([]);
});
