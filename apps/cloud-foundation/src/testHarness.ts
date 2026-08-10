import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadCloudTestEnv } from './env';

export interface TestActor {
  userId: string;
  email: string;
  client: SupabaseClient;
}

export interface CloudHarness {
  runId: string;
  admin: SupabaseClient;
  anon: SupabaseClient;
  createActor(label: string): Promise<TestActor>;
  trackWorkspace(id: string): void;
  trackInvitation(id: string): void;
  trackFile(id: string): void;
  trackFileVersion(id: string): void;
  trackStoragePath(path: string): void;
  cleanup(): Promise<void>;
}

export async function runWithCloudHarness<T>(
  run: (harness: CloudHarness) => Promise<T>
): Promise<T> {
  const harness = createCloudHarness();
  let completed = false;
  let result!: T;
  let primaryError: unknown;

  try {
    result = await run(harness);
    completed = true;
  } catch (error) {
    primaryError = error;
  }

  try {
    await harness.cleanup();
  } catch (cleanupError) {
    if (!completed) {
      const cleanupErrors =
        cleanupError instanceof AggregateError
          ? cleanupError.errors
          : [cleanupError];
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        'Cloud test and cleanup both failed'
      );
    }
    throw cleanupError;
  }

  if (!completed) throw primaryError;
  return result;
}

export function createCloudHarness(): CloudHarness {
  const env = loadCloudTestEnv();
  const runId = randomUUID();
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const anon = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const userIds = new Set<string>();
  const workspaceIds = new Set<string>();
  const invitationIds = new Set<string>();
  const fileIds = new Set<string>();
  const fileVersionIds = new Set<string>();
  const storagePaths = new Set<string>();
  let actorSequence = 0;

  return {
    runId,
    admin,
    anon,
    async createActor(label) {
      actorSequence += 1;
      const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const email = `kb-${runId}-${actorSequence}-${safeLabel}@example.invalid`;
      const { data: link, error: linkError } =
        await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (linkError) throw linkError;
      if (!link.user) throw new Error('Magic-link generation returned no user');
      userIds.add(link.user.id);
      const client = createClient(env.url, env.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data: session, error: verifyError } = await client.auth.verifyOtp({
        token_hash: link.properties.hashed_token,
        type: 'magiclink'
      });
      if (verifyError || !session.user) {
        throw verifyError ?? new Error('Magic-link exchange returned no user');
      }
      return { userId: session.user.id, email, client };
    },
    trackWorkspace(id) {
      workspaceIds.add(id);
    },
    trackInvitation(id) {
      invitationIds.add(id);
    },
    trackFile(id) {
      fileIds.add(id);
    },
    trackFileVersion(id) {
      fileVersionIds.add(id);
    },
    trackStoragePath(path) {
      storagePaths.add(path);
    },
    async cleanup() {
      const errors: unknown[] = [];

      const collectFailures = async (
        operations: Array<() => Promise<void>>
      ): Promise<void> => {
        const results = await Promise.allSettled(
          operations.map((operation) => operation())
        );
        for (const result of results) {
          if (result.status === 'rejected') errors.push(result.reason);
        }
      };

      await collectFailures(
        [...storagePaths].map((path) => async () => {
          const { error } = await admin.storage
            .from('documents')
            .remove([path]);
          if (error) throw error;
        })
      );

      await collectFailures(
        [...workspaceIds].map((workspaceId) => async () => {
          const { error } = await admin
            .from('workspaces')
            .delete()
            .eq('id', workspaceId);
          if (error) throw error;
        })
      );

      // A create_workspace RPC can commit even if its response is lost. The
      // generated users are unique to this run, so created_by stays bounded to
      // this run while covering that ambiguous-commit case.
      await collectFailures(
        [...userIds].map((userId) => async () => {
          const { error } = await admin
            .from('workspaces')
            .delete()
            .eq('created_by', userId);
          if (error) throw error;
        })
      );

      const verifyNoLeftovers = (
        table: 'workspace_invitations' | 'files' | 'file_versions',
        ids: Set<string>
      ): (() => Promise<void>) | undefined => {
        if (ids.size === 0) return undefined;
        return async () => {
          const trackedIds = [...ids];
          const { data, error } = await admin
            .from(table)
            .select('id')
            .in('id', trackedIds);
          if (error) throw error;
          if ((data ?? []).length > 0) {
            throw new Error(
              `Cloud test cleanup left tracked ${table} rows: ${(
                data ?? []
              )
                .map(({ id }) => id)
                .join(', ')}`
            );
          }
        };
      };
      await collectFailures(
        [
          verifyNoLeftovers('workspace_invitations', invitationIds),
          verifyNoLeftovers('files', fileIds),
          verifyNoLeftovers('file_versions', fileVersionIds)
        ].filter((operation): operation is () => Promise<void> =>
          Boolean(operation)
        )
      );

      await collectFailures(
        [...userIds].map((userId) => async () => {
          const { error } = await admin.auth.admin.deleteUser(userId);
          if (error) throw error;
        })
      );

      if (errors.length > 0) {
        throw new AggregateError(errors, 'Cloud test cleanup failed');
      }
    }
  };
}

export async function createWorkspace(
  client: SupabaseClient,
  harness: CloudHarness,
  name = '测试团队'
): Promise<string> {
  const { data, error } = await client.rpc('create_workspace', { p_name: name });
  if (error) throw error;
  if (typeof data !== 'string') {
    throw new Error('create_workspace returned no ID');
  }
  harness.trackWorkspace(data);
  return data;
}
