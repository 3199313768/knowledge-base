import { describe, expect, it } from 'vitest';

import {
  assertStageTransition,
  nextStage,
  retryDelayMs
} from './stageMachine';

describe('stageMachine', () => {
  it('returns the exact successor in the approved active sequence', () => {
    expect(nextStage('validate')).toBe('extract');
    expect(nextStage('extract')).toBe('chunk');
    expect(nextStage('chunk')).toBe('embed');
    expect(nextStage('embed')).toBe('finalize');
    expect(nextStage('finalize')).toBeNull();
  });

  it('accepts only the immediate successor transition', () => {
    expect(() => assertStageTransition('validate', 'extract')).not.toThrow();
    expect(() => assertStageTransition('extract', 'chunk')).not.toThrow();
    expect(() => assertStageTransition('chunk', 'embed')).not.toThrow();
    expect(() => assertStageTransition('embed', 'finalize')).not.toThrow();
  });

  it.each([
    ['validate', 'chunk'],
    ['extract', 'extract'],
    ['embed', 'chunk']
  ] as const)('rejects the illegal transition %s -> %s', (from, to) => {
    expect(() => assertStageTransition(from, to)).toThrow(
      `invalid processing stage transition: ${from} -> ${to}`
    );
  });

  it('uses three total attempts with the approved retry delays', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBeNull();
  });

  it.each([0, -1, 1.5, 4, Number.NaN])(
    'rejects invalid attempt %s',
    (attempt) => {
      expect(() => retryDelayMs(attempt)).toThrow(
        'attempt must be an integer between 1 and 3'
      );
    }
  );
});
