import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceLocation } from '@knowledge-base/contracts';
import { createMultilingualE5Provider } from './embed';

interface CorpusItem {
  fileId: string;
  workspaceId: string;
  fileName: string;
  sourceType: string;
  content: string;
  sourceLocation: SourceLocation;
}

interface QueryCase {
  query: string;
  expectedFileName: string;
}

interface MatchRow {
  file_id: string;
  file_name: string;
  content: string;
  source_location: SourceLocation;
  score: number;
}

export interface EvaluationReport {
  model: 'Xenova/multilingual-e5-small';
  dimensions: 384;
  queryCount: number;
  hits: number;
  recallAt5: number;
  results: Array<{
    query: string;
    expectedFileName: string;
    returnedFileNames: string[];
    hit: boolean;
  }>;
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: path.join(repoRoot, '.env.local') });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}

async function readJson<T>(relativePath: string): Promise<T> {
  const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
  return JSON.parse(content) as T;
}

export async function evaluateSearch(): Promise<EvaluationReport> {
  const corpus = await readJson<CorpusItem[]>('fixtures/search/corpus.json');
  const queries = await readJson<QueryCase[]>('fixtures/search/queries.json');
  const provider = await createMultilingualE5Provider();
  const client = createClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const passageVectors = await provider.embedPassages(
    corpus.map((item) => item.content)
  );
  const rows = corpus.map((item, index) => ({
    id: item.fileId,
    workspace_id: item.workspaceId,
    file_id: item.fileId,
    file_name: item.fileName,
    content: item.content,
    source_location: item.sourceLocation,
    embedding: vectorLiteral(passageVectors[index]!)
  }));

  const { error: upsertError } = await client
    .from('spike_chunks')
    .upsert(rows, { onConflict: 'id' });
  if (upsertError) throw upsertError;

  const results: EvaluationReport['results'] = [];
  for (const queryCase of queries) {
    const queryVector = await provider.embedQuery(queryCase.query);
    const { data, error } = await client.rpc('match_spike_chunks', {
      p_workspace_id: corpus[0]!.workspaceId,
      p_query_embedding: vectorLiteral(queryVector),
      p_limit: 5
    });
    if (error) throw error;
    const returnedFileNames = (data as MatchRow[]).map((row) => row.file_name);
    results.push({
      ...queryCase,
      returnedFileNames,
      hit: returnedFileNames.includes(queryCase.expectedFileName)
    });
  }

  const hits = results.filter((result) => result.hit).length;
  const report: EvaluationReport = {
    model: 'Xenova/multilingual-e5-small',
    dimensions: 384,
    queryCount: queries.length,
    hits,
    recallAt5: hits / queries.length,
    results
  };

  const outputDirectory = path.join(repoRoot, 'validation/phase-0');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, 'search-evaluation.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  return report;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const report = await evaluateSearch();
  console.log(JSON.stringify(report, null, 2));
  if (report.recallAt5 < 0.8) process.exitCode = 1;
}
