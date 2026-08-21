import { Button } from './ui/Button';
import type { DeletedFileSummary } from '../files/recycleBinService';

interface DeleteConfirmationDialogProps {
  file: DeletedFileSummary;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmationDialog({ file, isDeleting, onCancel, onConfirm }: DeleteConfirmationDialogProps) {
  return (
    <div className="confirm-overlay" role="presentation">
      <section aria-labelledby="permanent-delete-title" aria-modal="true" className="confirm-dialog" role="dialog">
        <h2 id="permanent-delete-title">永久删除文件？</h2>
        <p>“{file.displayName}”删除后无法恢复。系统会提交 Storage 与数据库清理任务。</p>
        <div className="confirm-dialog__actions">
          <Button disabled={isDeleting} onClick={onCancel}>取消</Button>
          <Button aria-busy={isDeleting} disabled={isDeleting} onClick={onConfirm} variant="primary">
            {isDeleting ? '正在提交清理…' : '确认永久删除'}
          </Button>
        </div>
      </section>
    </div>
  );
}
