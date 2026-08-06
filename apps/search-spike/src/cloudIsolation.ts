import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface MatchRow {
  file_name: string;
}

export interface CloudIsolationReport {
  workspaceAFileName: string;
  workspaceBFileName: string;
  returnedFileNames: string[];
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: path.join(repoRoot, '.env.local') });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function vectorLiteral(): string {
  return `[${Array.from({ length: 384 }, () => 0.1).join(',')}]`;
}

export async function runCloudIsolationCheck(): Promise<CloudIsolationReport> {
  const chunkIds = [randomUUID(), randomUUID()];
  const workspaceIds = [randomUUID(), randomUUID()];
  const fileIds = [randomUUID(), randomUUID()];
  const runId = randomUUID();
  const workspaceAFileName = `workspace-a-${runId}.pdf`;
  const workspaceBFileName = `workspace-b-${runId}.pdf`;
  const embedding = vectorLiteral();
  const client = createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    const { error: insertError } = await client.from('spike_chunks').insert([
      {
        id: chunkIds[0],
        workspace_id: workspaceIds[0],
        file_id: fileIds[0],
        file_name: workspaceAFileName,
        content: 'workspace A synthetic isolation row',
        source_location: { kind: 'page', label: '第 1 页' },
        embedding
      },
      {
        id: chunkIds[1],
        workspace_id: workspaceIds[1],
        file_id: fileIds[1],
        file_name: workspaceBFileName,
        content: 'workspace B synthetic isolation row',
        source_location: { kind: 'page', label: '第 1 页' },
        embedding
      }
    ]);
    if (insertError) throw insertError;

    const { data, error: matchError } = await client.rpc(
      'match_spike_chunks',
      {
        p_workspace_id: workspaceIds[0],
        p_query_embedding: embedding,
        p_limit: 10
      }
    );
    if (matchError) throw matchError;

    return {
      workspaceAFileName,
      workspaceBFileName,
      returnedFileNames: (data as MatchRow[]).map((row) => row.file_name)
    };
  } finally {
    const { error: cleanupError } = await client
      .from('spike_chunks')
      .delete()
      .in('id', chunkIds);
    if (cleanupError) throw cleanupError;
  }
}
