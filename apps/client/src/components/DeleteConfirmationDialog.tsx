import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@oxygen-design/ui';
import type { DeletedFileSummary } from '../files/recycleBinService';

interface DeleteConfirmationDialogProps {
  file: DeletedFileSummary;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmationDialog({ file, isDeleting, onCancel, onConfirm }: DeleteConfirmationDialogProps) {
  return (
    <AlertDialog open>
      <AlertDialogContent className="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>永久删除文件？</AlertDialogTitle>
          <AlertDialogDescription>
            “{file.displayName}”删除后无法恢复。系统会提交 Storage 与数据库清理任务。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="confirm-dialog__actions">
          <AlertDialogCancel disabled={isDeleting} onClick={onCancel}>取消</AlertDialogCancel>
          <AlertDialogAction
            aria-busy={isDeleting}
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            variant="destructive"
          >
            {isDeleting ? '正在提交清理…' : '确认永久删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
