import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseBrowserClient } from '../lib/supabaseClient';
import {
  defaultSearchHistoryService,
  SearchHistoryServiceError,
  type SearchHistoryService
} from './searchHistoryService';

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseBrowserClient: vi.fn()
}));

beforeEach(() => {
  vi.mocked(getSupabaseBrowserClient).mockReset();
});

describe('SearchHistoryService contract', () => {
  it('lists the current workspace history in most-recent order', async () => {
    const limit = vi.fn(async () => ({
      data: [
        {
          id: 'history-a',
          query: '年度 Pricing',
          updated_at: '2026-08-21T09:00:00.000Z',
          created_at: '2026-08-21T08:00:00.000Z'
        }
      ],
      error: null
    }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ from } as never);

    await expect(defaultSearchHistoryService.list('11111111-1111-4111-8111-111111111111', 10)).resolves.toEqual([
      {
        id: 'history-a',
        query: '年度 Pricing',
        createdAt: '2026-08-21T08:00:00.000Z',
        updatedAt: '2026-08-21T09:00:00.000Z'
      }
    ]);
    expect(from).toHaveBeenCalledWith('search_history');
    expect(eq).toHaveBeenCalledWith('workspace_id', '11111111-1111-4111-8111-111111111111');
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(10);
  });

  it('records a query through the bounded server-side history RPC', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc
    } as never);

    await expect(
      defaultSearchHistoryService.record({ workspaceId: '11111111-1111-4111-8111-111111111111', query: '  年度 Pricing  ' })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('record_search_history', {
      p_workspace_id: '11111111-1111-4111-8111-111111111111',
      p_query: '  年度 Pricing  '
    });
  });

  it('delegates the 21st distinct record to the bounded server-side RPC', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ rpc } as never);

    await Promise.all(
      Array.from({ length: 21 }, (_value, index) =>
        defaultSearchHistoryService.record({
          workspaceId: '11111111-1111-4111-8111-111111111111',
          query: `第 ${index + 1} 条搜索`
        })
      )
    );

    expect(rpc).toHaveBeenCalledTimes(21);
    expect(rpc).toHaveBeenLastCalledWith('record_search_history', {
      p_workspace_id: '11111111-1111-4111-8111-111111111111',
      p_query: '第 21 条搜索'
    });
  });

  it('rejects blank or overlong history entries before calling the RPC', async () => {
    const rpc = vi.fn();
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({
      rpc
    } as never);

    await expect(
      defaultSearchHistoryService.record({ workspaceId: '11111111-1111-4111-8111-111111111111', query: '   ' })
    ).rejects.toMatchObject({
      kind: 'validation',
      message: '请输入有效的搜索内容'
    });
    await expect(
      defaultSearchHistoryService.record({ workspaceId: '11111111-1111-4111-8111-111111111111', query: 'a'.repeat(501) })
    ).rejects.toMatchObject({
      kind: 'validation',
      message: '搜索内容不能超过 500 个字符'
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('counts trimmed Unicode code points when enforcing the 500-character limit', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ rpc } as never);

    await expect(
      defaultSearchHistoryService.record({
        workspaceId: '11111111-1111-4111-8111-111111111111',
        query: `  ${'😀'.repeat(500)}  `
      })
    ).resolves.toBeUndefined();
    await expect(
      defaultSearchHistoryService.record({
        workspaceId: '11111111-1111-4111-8111-111111111111',
        query: `${'😀'.repeat(501)}`
      })
    ).rejects.toMatchObject({
      kind: 'validation',
      message: '搜索内容不能超过 500 个字符'
    });
  });

  it('rejects an invalid workspace identifier before calling Supabase', async () => {
    const rpc = vi.fn();
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ rpc } as never);

    await expect(defaultSearchHistoryService.list('  not-a-uuid  ', 10)).rejects.toMatchObject({
      kind: 'validation',
      message: '当前团队信息无效，请重新选择团队'
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('clears only the current workspace history through the authenticated client', async () => {
    const eq = vi.fn(async () => ({ data: null, error: null }));
    const remove = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: remove }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ from } as never);

    await expect(defaultSearchHistoryService.clear('11111111-1111-4111-8111-111111111111')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('search_history');
    expect(remove).toHaveBeenCalledWith();
    expect(eq).toHaveBeenCalledWith('workspace_id', '11111111-1111-4111-8111-111111111111');
  });

  it.each([
    [{ status: 401, message: 'JWT expired' }, 'authentication'],
    [{ code: '22023', message: 'workspace is required' }, 'validation'],
    [{ code: '22P02', message: 'invalid input syntax for type uuid' }, 'validation'],
    [{ code: '42501', message: 'permission denied for table search_history' }, 'permission'],
    [{ status: 403, message: 'forbidden' }, 'permission'],
    [new TypeError('Failed to fetch'), 'network'],
    [{ message: 'unexpected backend failure' }, 'unknown']
  ])('maps %s service failures to stable errors', async (error, kind) => {
    const limit = vi.fn(async () => ({ data: null, error }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseBrowserClient).mockReturnValue({ from } as never);

    await expect(defaultSearchHistoryService.list('11111111-1111-4111-8111-111111111111', 10)).rejects.toMatchObject({
      kind
    });
    await expect(defaultSearchHistoryService.list('11111111-1111-4111-8111-111111111111', 10)).rejects.toBeInstanceOf(
      SearchHistoryServiceError
    );
  });

  it('exposes the declared service contract', async () => {
    const service: SearchHistoryService = defaultSearchHistoryService;
    expect(service.list).toBeTypeOf('function');
    expect(service.record).toBeTypeOf('function');
    expect(service.clear).toBeTypeOf('function');
  });
});
