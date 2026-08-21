import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseBrowserClient } from '../lib/supabaseClient';
import {
  defaultSearchService,
  SearchServiceError,
  neutralQueryVectorLiteral,
  tokenizeSearchQuery,
  type SearchService
} from './searchService';

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseBrowserClient: vi.fn()
}));

beforeEach(() => {
  vi.mocked(getSupabaseBrowserClient).mockReset();
});

describe('searchService helpers', () => {
  it('tokenizes Chinese and latin search text for the search RPC', () => {
    expect(tokenizeSearchQuery('年度 Pricing 报价')).toEqual([
      '年度',
      'pricing',
      '报价'
    ]);
  });

  it('builds a deterministic 384-dimension neutral vector literal', () => {
    const literal = neutralQueryVectorLiteral();
    const values = literal.slice(1, -1).split(',');

    expect(values).toHaveLength(384);
    expect(values.every((value) => value === '0')).toBe(true);
  });
});

describe('SearchService contract', () => {
  it('returns mapped search result summaries to UI callers', async () => {
    const searchService: SearchService = {
      search: vi.fn(async () => [
        {
          fileId: 'file-a',
          fileName: '产品方案.pdf',
          score: 0.42,
          snippet: '年度报价策略',
          sourceLabel: '第 3 页'
        }
      ])
    };

    await expect(
      searchService.search({ query: '报价', workspaceId: 'workspace-a' })
    ).resolves.toEqual([
      {
        fileId: 'file-a',
        fileName: '产品方案.pdf',
        score: 0.42,
        snippet: '年度报价策略',
        sourceLabel: '第 3 页'
      }
    ]);
  });

  it('calls search_workspace_files RPC and maps rows for the UI', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          file_id: 'file-a',
          file_name: '产品方案.pdf',
          score: 0.42,
          snippet: '年度报价策略',
          source_location: { label: '第 3 页' }
        },
        {
          file_id: 'file-b',
          file_name: '访谈.docx',
          score: 0.21,
          snippet: null,
          source_location: null
        }
      ],
      error: null
    }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(
      defaultSearchService.search({ query: ' 年度 Pricing 年度 ', workspaceId: 'workspace-a' })
    ).resolves.toEqual([
      {
        fileId: 'file-a',
        fileName: '产品方案.pdf',
        score: 0.42,
        snippet: '年度报价策略',
        sourceLabel: '第 3 页'
      },
      {
        fileId: 'file-b',
        fileName: '访谈.docx',
        score: 0.21,
        snippet: '',
        sourceLabel: '来源未知'
      }
    ]);
    expect(rpc).toHaveBeenCalledWith('search_workspace_files', {
      p_filters: {},
      p_limit: 20,
      p_query_embedding: neutralQueryVectorLiteral(),
      p_query_text: '年度 Pricing 年度',
      p_query_tokens: ['年度', 'pricing'],
      p_workspace_id: 'workspace-a'
    });
  });

  it('returns an empty result list when the search RPC finds no files', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(
      defaultSearchService.search({ query: '不存在的资料', workspaceId: 'workspace-a' })
    ).resolves.toEqual([]);
  });

  it('rejects blank search text before calling Supabase', async () => {
    await expect(
      defaultSearchService.search({ query: '   ', workspaceId: 'workspace-a' })
    ).rejects.toThrow('请输入搜索内容');
    expect(getSupabaseBrowserClient).not.toHaveBeenCalled();
  });

  it('maps missing browser client configuration to a safe configuration error', async () => {
    vi.mocked(getSupabaseBrowserClient).mockImplementation(() => {
      throw new Error('Supabase 客户端配置缺失');
    });

    await expect(defaultSearchService.search({ query: '报价', workspaceId: 'workspace-a' })).rejects.toMatchObject({
      kind: 'configuration',
      message: '搜索服务暂不可用，请检查应用配置后重试'
    });
  });

  it.each([
    [
      { code: '42501', message: 'permission denied for function search_workspace_files' },
      'permission',
      '暂无权限搜索当前团队资料，请确认团队权限'
    ],
    [
      { code: 'PGRST202', message: 'Could not find the function search_workspace_files' },
      'configuration',
      '搜索服务暂不可用，请检查应用配置后重试'
    ],
    [new TypeError('Failed to fetch'), 'network', '网络异常，搜索未完成，请检查网络后重试'],
    [{ message: 'unexpected backend failure' }, 'unknown', '搜索失败，请稍后重试']
  ])('maps %s failures to a stable SearchServiceError', async (error, kind, message) => {
    const rpc = vi.fn(async () => ({ data: null, error }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    await expect(defaultSearchService.search({ query: '报价', workspaceId: 'workspace-a' })).rejects.toMatchObject({
      kind,
      message
    });
    await expect(defaultSearchService.search({ query: '报价', workspaceId: 'workspace-a' })).rejects.toBeInstanceOf(
      SearchServiceError
    );
  });
});
