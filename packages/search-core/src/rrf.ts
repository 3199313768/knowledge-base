import { assertEmbedding } from './e5';

export const PHASE2_RANKING_V1 = Object.freeze({
  semanticWeight: 0.65,
  lexicalWeight: 0.35,
  k: 60,
  maxCandidatesPerList: 50,
  maxSnippets: 3,
  secondSnippetWeight: 0.25,
  thirdSnippetWeight: 0.1,
  filenameBoost: 0.05
});

export interface RankedChunk {
  id: string;
  score: number;
  [key: string]: unknown;
}

export interface RankedList {
  weight: number;
  ids: readonly (string | RankedChunk)[];
}

export interface RrfConfig {
  k?: number;
}

export function fuseRrf(
  lists: readonly RankedList[],
  config: RrfConfig = {}
): RankedChunk[] {
  const k = config.k ?? PHASE2_RANKING_V1.k;
  if (!Number.isFinite(k) || k < 0) throw new Error('RRF k must be a non-negative finite number');

  const scores = new Map<string, number>();
  const payloads = new Map<string, RankedChunk>();
  for (const list of lists) {
    if (!Number.isFinite(list.weight) || list.weight < 0) {
      throw new Error('RRF weights must be non-negative finite numbers');
    }
    const seen = new Set<string>();
    for (const [position, item] of list.ids.slice(0, PHASE2_RANKING_V1.maxCandidatesPerList).entries()) {
      const candidate = typeof item === 'string'
        ? ({ id: item, score: 0 } satisfies RankedChunk)
        : item;
      if (!candidate.id || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      scores.set(candidate.id, (scores.get(candidate.id) ?? 0) + list.weight / (k + position + 1));
      if (!payloads.has(candidate.id)) payloads.set(candidate.id, candidate);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ ...(payloads.get(id) ?? { id }), id, score }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function toVectorLiteral(vector: readonly number[]): string {
  assertEmbedding(vector);
  return `[${vector.join(',')}]`;
}

export function assertSearchLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('search limit must be an integer between 1 and 50');
  }
}
