import { describe, expect, it } from 'vitest';

import { fuseRrf, PHASE2_RANKING_V1 } from './rrf';

describe('fuseRrf', () => {
  it('uses weighted RRF without rewarding missing ranks', () => {
    const result = fuseRrf([
      { weight: 0.65, ids: ['semantic-only', 'both'] },
      { weight: 0.35, ids: ['both', 'lexical-only'] }
    ], { k: 60 });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'both' })
    ]));
    expect(result[0]?.id).toBe('both');
    expect(result.find((item) => item.id === 'both')?.score).toBeGreaterThan(
      result.find((item) => item.id === 'semantic-only')?.score ?? 0
    );
  });

  it('exposes the approved versioned ranking constants', () => {
    expect(PHASE2_RANKING_V1).toMatchObject({ semanticWeight: 0.65, lexicalWeight: 0.35, k: 60 });
  });
});
