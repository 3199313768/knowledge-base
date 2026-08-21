import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchPanel } from './SearchPanel';
import type { SearchHistoryService } from '../search/searchHistoryService';
import type { SearchService } from '../search/searchService';

function createHistoryService() {
  const service: SearchHistoryService = {
    list: vi.fn(async () => [
      {
        id: 'history-a',
        query: '历史查询',
        createdAt: '2026-08-21T08:00:00.000Z',
        updatedAt: '2026-08-21T09:00:00.000Z'
      }
    ]),
    record: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined)
  };
  return service;
}

afterEach(() => cleanup());

describe('SearchPanel search history integration', () => {
  it('records each successful request when searches overlap', async () => {
    let resolveA!: (value: never[]) => void;
    let rejectB!: (reason: unknown) => void;
    const searchService: SearchService = {
      search: vi.fn(({ query }) => {
        if (query === 'A') {
          return new Promise<never[]>((resolve) => {
            resolveA = resolve;
          });
        }
        return new Promise<never[]>((_resolve, reject) => {
          rejectB = reject;
        });
      })
    };
    const searchHistoryService = createHistoryService();
    render(
      <SearchPanel
        searchHistoryService={searchHistoryService}
        searchService={searchService}
        workspaceId="workspace-a"
      />
    );

    const input = screen.getByLabelText('搜索当前团队资料');
    const form = input.closest('form');
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.submit(form!);
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.submit(form!);

    await act(async () => resolveA([]));
    await waitFor(() => {
      expect(searchHistoryService.record).toHaveBeenCalledWith({
        workspaceId: 'workspace-a',
        query: 'A'
      });
    });
    await act(async () => rejectB(new Error('network')));
    expect(searchHistoryService.record).toHaveBeenCalledTimes(1);
  });

  it('records only a successful non-empty search and re-runs history selections', async () => {
    const searchService: SearchService = {
      search: vi.fn(async ({ query }) =>
        query === '失败查询' ? Promise.reject(new Error('network')) : []
      )
    };
    const searchHistoryService = createHistoryService();
    render(
      <SearchPanel
        searchHistoryService={searchHistoryService}
        searchService={searchService}
        workspaceId="workspace-a"
      />
    );

    await screen.findByRole('button', { name: '搜索历史：历史查询' });
    fireEvent.click(screen.getByRole('button', { name: '搜索历史：历史查询' }));
    await waitFor(() => {
      expect(searchService.search).toHaveBeenCalledWith({
        query: '历史查询',
        workspaceId: 'workspace-a'
      });
    });
    await waitFor(() => {
      expect(searchHistoryService.record).toHaveBeenCalledWith({
        workspaceId: 'workspace-a',
        query: '历史查询'
      });
    });

    fireEvent.change(screen.getByLabelText('搜索当前团队资料'), { target: { value: '失败查询' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await screen.findByRole('alert');
    expect(searchHistoryService.record).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('搜索当前团队资料'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(searchHistoryService.record).toHaveBeenCalledTimes(1));
  });

  it('clears history from the panel', async () => {
    const searchService: SearchService = { search: vi.fn(async () => []) };
    const searchHistoryService = createHistoryService();
    render(
      <SearchPanel
        searchHistoryService={searchHistoryService}
        searchService={searchService}
        workspaceId="workspace-a"
      />
    );

    await screen.findByRole('button', { name: '搜索历史：历史查询' });
    fireEvent.click(screen.getByRole('button', { name: '清空搜索历史' }));

    await waitFor(() => expect(searchHistoryService.clear).toHaveBeenCalledWith('workspace-a'));
  });
});
