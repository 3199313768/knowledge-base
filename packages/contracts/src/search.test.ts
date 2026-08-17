import { describe, expect, it } from 'vitest';
import { assertSearchResult } from './search';

describe('assertSearchResult', () => {
  it('accepts a result with a source location', () => {
    expect(() =>
      assertSearchResult({
        fileId: 'file-1',
        fileName: '华东区客户年度报价方案.pptx',
        score: 0.91,
        snippet: '采用年度阶梯报价',
        sourceLocation: { kind: 'slide', label: '第 12 页' }
      })
    ).not.toThrow();
  });

  it('accepts a result with a versioned processing source location', () => {
    expect(() =>
      assertSearchResult({
        fileId: 'file-2',
        fileName: '处理说明.pdf',
        score: 0.88,
        snippet: '第 3 页正文',
        sourceLocation: {
          schemaVersion: 1,
          kind: 'page',
          page: 3,
          label: '第 3 页'
        }
      })
    ).not.toThrow();
  });

  it('rejects a result without a source label', () => {
    expect(() =>
      assertSearchResult({
        fileId: 'file-1',
        fileName: '报价方案.pptx',
        score: 0.91,
        snippet: '年度阶梯报价',
        sourceLocation: { kind: 'slide', label: '' }
      })
    ).toThrow('sourceLocation.label');
  });
});
