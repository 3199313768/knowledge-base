import { describe, expect, it } from 'vitest';

import { tokenizeLexical } from './tokenize';

describe('tokenizeLexical', () => {
  it('creates Chinese bigrams and normalized Latin terms', () => {
    expect(tokenizeLexical('去年 Quote-2025 报价')).toEqual([
      '去年',
      'quote',
      '2025',
      '报价'
    ]);
  });

  it('normalizes compatibility forms and keeps first-seen order', () => {
    expect(tokenizeLexical('ＡＢＣ abc 报价报价')).toEqual(['abc', '报价', '价报']);
  });

  it('returns no terms for punctuation-only input', () => {
    expect(tokenizeLexical('--- … !!!')).toEqual([]);
  });
});
