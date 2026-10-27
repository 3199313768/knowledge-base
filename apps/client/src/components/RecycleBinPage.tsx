import { EmptyState, PageHeader, StatusMessage } from '@oxygen-design/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeleteConfirmationDialog } from './DeleteConfirmationDialog';
import { Button } from './ui/Button';
import type { DeletedFileSummary, RecycleBinService } from '../files/recycleBinService';
import { RecycleBinServiceError } from '../files/recycleBinService';
import type { WorkspaceSummary } from '../workspaces/workspaceService';

interface RecycleBinPageProps { currentWorkspace: WorkspaceSummary; service: RecycleBinService; }
function safeMessage(error: unknown) { return error instanceof RecycleBinServiceError ? error.message : '回收站操作失败，请稍后重试。'; }

export function RecycleBinPage({ currentWorkspace, service }: RecycleBinPageProps) {
  const generation = useRef(0);
  const [files, setFiles] = useState<DeletedFileSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeletedFileSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = ++generation.current;
    setIsLoading(true); setError(null);
    try { const next = await service.listDeletedFiles(currentWorkspace.id); if (token === generation.current) setFiles(next); }
    catch (caught) { if (token === generation.current) setError(safeMessage(caught)); }
    finally { if (token === generation.current) setIsLoading(false); }
  }, [currentWorkspace.id, service]);

  useEffect(() => { setFiles([]); setMessage(null); void load(); return () => { generation.current += 1; }; }, [load]);

  async function restore(file: DeletedFileSummary) {
    if (pendingId) return;
    setPendingId(file.fileId); setError(null);
    try { await service.restoreFile(file.fileId); setMessage(`已恢复“${file.displayName}”`); await load(); }
    catch (caught) { setError(safeMessage(caught)); }
    finally { setPendingId(null); }
  }

  async function permanentlyDelete() {
    if (!deleteTarget || pendingId) return;
    const target = deleteTarget; setPendingId(target.fileId); setError(null);
    try { await service.permanentlyDeleteFile(target.fileId); setMessage('已提交永久删除清理任务，完成前文件仍可能暂时显示。'); setDeleteTarget(null); await load(); }
    catch (caught) { setError(safeMessage(caught)); }
    finally { setPendingId(null); }
  }

  return <section aria-label="回收站" className="content-pane recycle-bin">
    <PageHeader description="文件保留 30 天，到期后由系统清理。" title="回收站" />
    {message ? <StatusMessage>{message}</StatusMessage> : null}
    {error ? <StatusMessage action={<Button onClick={() => void load()} variant="link">重试</Button>} tone="error">{error}</StatusMessage> : null}
    {isLoading ? <StatusMessage>正在读取回收站…</StatusMessage> : null}
    {!isLoading && !error && files.length === 0 ? <div className="empty-state"><EmptyState description="删除的文件会在这里保留 30 天。" title="回收站为空" /></div> : null}
    {files.length ? <div aria-label="已删除文件列表" className="recycle-list">{files.map(file => <article key={file.fileId}>
      <div><h3>{file.displayName}</h3><p>删除时间：{new Date(file.deletedAt).toLocaleString('zh-CN')}</p><p>预计清理：{new Date(file.purgeAt).toLocaleString('zh-CN')}</p></div>
      <div><Button disabled={Boolean(pendingId)} onClick={() => void restore(file)}>恢复文件</Button><Button disabled={Boolean(pendingId)} onClick={() => setDeleteTarget(file)} variant="link">永久删除</Button></div>
    </article>)}</div> : null}
    {deleteTarget ? <DeleteConfirmationDialog file={deleteTarget} isDeleting={pendingId === deleteTarget.fileId} onCancel={() => setDeleteTarget(null)} onConfirm={() => void permanentlyDelete()} /> : null}
  </section>;
}
