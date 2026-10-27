import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchHistory } from './SearchHistory';
import type { SearchHistoryItem } from '../search/searchHistoryService';

const items: SearchHistoryItem[] = [
  {
    id: 'history-a',
    query: '年度报价',
    createdAt: '2026-08-21T08:00:00.000Z',
    updatedAt: '2026-08-21T09:00:00.000Z'
  }
];

describe('SearchHistory', () => {
  afterEach(() => cleanup());

  it('shows a loading status while history is loading', () => {
    render(<SearchHistory items={[]} isLoading onClear={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('正在读取搜索历史…');
    expect(screen.getByRole('status')).toHaveClass('oxygen-status-message');
  });

  it('does not render a history section when there is no history', () => {
    render(<SearchHistory items={[]} isLoading={false} onClear={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.queryByRole('region', { name: '搜索历史' })).not.toBeInTheDocument();
    expect(screen.queryByText('暂无搜索历史')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清空搜索历史' })).not.toBeInTheDocument();
  });

  it('re-runs a selected query and clears history through accessible actions', () => {
    const onSelect = vi.fn();
    const onClear = vi.fn();
    render(<SearchHistory items={items} isLoading={false} onClear={onClear} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: '搜索历史：年度报价' }));
    fireEvent.click(screen.getByRole('button', { name: '清空搜索历史' }));

    expect(onSelect).toHaveBeenCalledWith('年度报价');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders a safe retryable error state', () => {
    const onRetry = vi.fn();
    render(
      <SearchHistory
        error="搜索历史服务暂不可用，请稍后重试"
        items={[]}
        isLoading={false}
        onClear={vi.fn()}
        onRetry={onRetry}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('搜索历史服务暂不可用，请稍后重试');
    fireEvent.click(screen.getByRole('button', { name: '重试读取搜索历史' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
