import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecycleBinPage } from './RecycleBinPage';
import type { RecycleBinService } from '../files/recycleBinService';

const file = { fileId: 'file-1', workspaceId: 'workspace-1', displayName: '方案.pdf', deletedAt: '2026-08-21T00:00:00Z', purgeAt: '2026-09-20T00:00:00Z' };

describe('RecycleBinPage', () => {
  it('shows the empty state', async () => {
    const service: RecycleBinService = { listDeletedFiles: vi.fn(async () => []), restoreFile: vi.fn(), permanentlyDeleteFile: vi.fn() };
    render(<RecycleBinPage currentWorkspace={{ id: 'workspace-1', name: '远算', createdAt: '' }} service={service} />);
    expect(await screen.findByRole('heading', { name: '回收站为空' })).toBeInTheDocument();
  });

  it('restores and confirms permanent deletion', async () => {
    const service: RecycleBinService = {
      listDeletedFiles: vi.fn(async () => [file]),
      restoreFile: vi.fn(async () => undefined),
      permanentlyDeleteFile: vi.fn(async () => ({ cleanupJobId: 'job-1', status: 'cleanup_pending' as const }))
    };
    render(<RecycleBinPage currentWorkspace={{ id: 'workspace-1', name: '远算', createdAt: '' }} service={service} />);
    fireEvent.click(await screen.findByRole('button', { name: '永久删除' }));
    expect(screen.getByRole('dialog', { name: '永久删除文件？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复文件' }));
    await waitFor(() => expect(service.restoreFile).toHaveBeenCalledWith('file-1'));
  });
});
