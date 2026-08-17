import { useState } from 'react';
import { AppSidebar } from './AppSidebar';
import { WorkspaceDashboard } from './WorkspaceDashboard';
import { useFiles } from '../files/useFiles';
import { useWorkspaces } from '../workspaces/useWorkspaces';
import type { FileService } from '../files/fileService';
import type { FileSummary } from '../files/fileService';
import type { SearchService } from '../search/searchService';
import type { UploadService } from '../uploads/uploadService';
import type { WorkspaceService } from '../workspaces/workspaceService';

interface MainShellProps {
  email: string;
  fileService: FileService;
  onSignOutCurrentDevice: () => Promise<void>;
  searchService: SearchService;
  uploadService: UploadService;
  workspaceService: WorkspaceService;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : '文件操作失败';
}

export function MainShell({
  email,
  fileService,
  onSignOutCurrentDevice,
  searchService,
  uploadService,
  workspaceService
}: MainShellProps) {
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const workspaceState = useWorkspaces(workspaceService);
  const filesState = useFiles(fileService, workspaceState.currentWorkspace?.id ?? null);

  async function deleteFile(file: FileSummary) {
    if (!window.confirm(`确定删除“${file.displayName}”吗？`)) {
      return;
    }

    setFileActionError(null);
    try {
      await fileService.softDeleteFile(file.id);
      await filesState.refreshFiles();
    } catch (caughtError) {
      setFileActionError(`删除文件失败：${safeMessage(caughtError)}。请稍后重试。`);
    }
  }

  async function retryFile(file: FileSummary) {
    if (!file.currentVersion?.id) {
      return;
    }

    setFileActionError(null);
    try {
      await fileService.retryFileVersion(file.currentVersion.id);
      await filesState.refreshFiles();
    } catch (caughtError) {
      setFileActionError(`重新处理失败：${safeMessage(caughtError)}。请稍后重试。`);
    }
  }

  return (
    <main className="shell">
      <div className="app-frame">
        <AppSidebar
          currentWorkspace={workspaceState.currentWorkspace}
          email={email}
          error={workspaceState.error}
          isCreatingWorkspace={workspaceState.isCreating}
          isLoadingWorkspaces={workspaceState.isLoading}
          onCreateWorkspace={workspaceState.createWorkspace}
          onSelectWorkspace={workspaceState.selectWorkspace}
          onSignOutCurrentDevice={onSignOutCurrentDevice}
          workspaces={workspaceState.workspaces}
        />

        <WorkspaceDashboard
          currentWorkspace={workspaceState.currentWorkspace}
          fileError={filesState.error ?? fileActionError}
          files={filesState.files}
          isLoadingFiles={filesState.isLoading}
          lastRefreshedAt={filesState.lastRefreshedAt}
          onDeleteFile={deleteFile}
          onRefreshFiles={filesState.refreshFiles}
          onRetryFile={retryFile}
          searchService={searchService}
          uploadService={uploadService}
        />
      </div>
    </main>
  );
}
