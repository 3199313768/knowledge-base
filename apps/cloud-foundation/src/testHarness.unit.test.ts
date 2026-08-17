import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  admin: {} as Record<string, unknown>,
  actor: {} as Record<string, unknown>,
  createClient: vi.fn(),
  leftoverRows: new Map<string, string[]>(),
  storageFailures: new Map<string, Error>(),
  workspaceFailures: new Map<string, Error>(),
  userFailures: new Map<string, Error>(),
  workspaceDeleteFilters: [] as Array<{ column: string; value: string }>,
  cleanupOperations: [] as string[],
  deletedUsers: [] as string[]
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: state.createClient }));
vi.mock('./env', () => ({
  loadCloudTestEnv: () => ({
    url: 'https://dedicated-test-project.supabase.co',
    anonKey: 'anon-key',
    serviceRoleKey: 'service-role-key',
    projectRef: 'dedicated-test-project'
  })
}));

import * as harnessModule from './testHarness';

function configureClients() {
  state.leftoverRows.clear();
  state.workspaceFailures.clear();
  state.storageFailures.clear();
  state.userFailures.clear();
  state.workspaceDeleteFilters.length = 0;
  state.cleanupOperations.length = 0;
  state.deletedUsers.length = 0;

  state.admin.auth = {
    admin: {
      generateLink: vi.fn(async () => ({
        data: {
          user: { id: 'generated-user' },
          properties: { hashed_token: 'hashed-token' }
        },
        error: null
      })),
      deleteUser: vi.fn(async (userId: string) => {
        state.cleanupOperations.push(`user:${userId}`);
        state.deletedUsers.push(userId);
        return { error: state.userFailures.get(userId) ?? null };
      })
    }
  };
  state.admin.storage = {
    from: vi.fn(() => ({
      remove: vi.fn(async (paths: string[]) => {
        const path = paths[0];
        if (path === undefined) {
          throw new Error('storage path is required');
        }
        state.cleanupOperations.push(`storage:${path}`);
        return { error: state.storageFailures.get(path) ?? null };
      })
    }))
  };
  state.admin.from = vi.fn((table: string) => ({
    delete: () => ({
      eq: async (column: string, value: string) => {
        state.cleanupOperations.push(`workspace:${column}:${value}`);
        state.workspaceDeleteFilters.push({ column, value });
        return {
          error: state.workspaceFailures.get(`${column}:${value}`) ?? null
        };
      }
    }),
    select: () => ({
      in: async (_column: string, ids: string[]) => {
        state.cleanupOperations.push(`verify:${table}:${ids.join(',')}`);
        return {
          data: (state.leftoverRows.get(table) ?? []).map((id) => ({ id })),
          error: null
        };
      }
    })
  }));
  state.actor.auth = {
    verifyOtp: vi.fn(async () => ({
      data: { user: { id: 'session-user' } },
      error: null
    }))
  };
  state.createClient.mockImplementation((_url: string, key: string) =>
    key === 'service-role-key' ? state.admin : state.actor
  );
}

beforeEach(() => {
  state.createClient.mockReset();
  configureClients();
});

it('cleans up a generated user when its magic-link exchange fails', async () => {
  const harness = harnessModule.createCloudHarness();
  state.actor.auth = {
    verifyOtp: vi.fn(async () => ({
      data: { user: null },
      error: new Error('magic-link exchange failed')
    }))
  };

  await expect(harness.createActor('failed-exchange')).rejects.toThrow(
    'magic-link exchange failed'
  );
  await expect(harness.cleanup()).resolves.toBeUndefined();

  expect(state.workspaceDeleteFilters).toEqual([
    { column: 'created_by', value: 'generated-user' }
  ]);
  expect(state.cleanupOperations).toEqual([
    'workspace:created_by:generated-user',
    'user:generated-user'
  ]);
  expect(state.deletedUsers).toEqual(['generated-user']);
});

it('attempts every cleanup and aggregates its failures', async () => {
  const harness = harnessModule.createCloudHarness();
  await harness.createActor('cleanup');
  harness.trackWorkspace('workspace-a');
  harness.trackWorkspace('workspace-b');
  harness.trackInvitation('invitation-a');
  harness.trackFile('file-a');
  harness.trackFileVersion('version-a');
  harness.trackStoragePath('workspace-a/file/version/source.pdf');
  state.leftoverRows.set('workspace_invitations', ['invitation-a']);
  state.leftoverRows.set('files', ['file-a']);
  state.leftoverRows.set('file_versions', ['version-a']);
  state.storageFailures.set(
    'workspace-a/file/version/source.pdf',
    new Error('storage cleanup failed')
  );
  state.workspaceFailures.set(
    'id:workspace-a',
    new Error('workspace-a failed')
  );
  state.workspaceFailures.set(
    'id:workspace-b',
    new Error('workspace-b failed')
  );
  state.workspaceFailures.set(
    'created_by:generated-user',
    new Error('created-by cleanup failed')
  );
  state.userFailures.set('generated-user', new Error('user cleanup failed'));

  try {
    await harness.cleanup();
    throw new Error('cleanup unexpectedly succeeded');
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(8);
  }

  expect(state.workspaceDeleteFilters).toEqual([
    { column: 'id', value: 'workspace-a' },
    { column: 'id', value: 'workspace-b' },
    { column: 'created_by', value: 'generated-user' }
  ]);
  expect(state.cleanupOperations).toEqual([
    'storage:workspace-a/file/version/source.pdf',
    'workspace:id:workspace-a',
    'workspace:id:workspace-b',
    'workspace:created_by:generated-user',
    'verify:workspace_invitations:invitation-a',
    'verify:files:file-a',
    'verify:file_versions:version-a',
    'user:generated-user'
  ]);
  expect(state.deletedUsers).toEqual(['generated-user']);
});

it('preserves a test failure alongside cleanup failures', async () => {
  const runWithCloudHarness = (
    harnessModule as typeof harnessModule & {
      runWithCloudHarness?: <T>(
        run: (harness: ReturnType<typeof harnessModule.createCloudHarness>) => Promise<T>
      ) => Promise<T>;
    }
  ).runWithCloudHarness;

  if (!runWithCloudHarness) {
    expect(runWithCloudHarness).toBeTypeOf('function');
    return;
  }

  state.workspaceFailures.set(
    'id:workspace-a',
    new Error('cleanup failed')
  );
  const primaryError = new Error('test assertion failed');

  await expect(
    runWithCloudHarness(async (harness) => {
      harness.trackWorkspace('workspace-a');
      throw primaryError;
    })
  ).rejects.toSatisfy((error: unknown) => {
    return (
      error instanceof AggregateError &&
      error.errors.includes(primaryError) &&
      error.errors.some(
        (cleanupError) =>
          cleanupError instanceof Error && cleanupError.message === 'cleanup failed'
      )
    );
  });
});
