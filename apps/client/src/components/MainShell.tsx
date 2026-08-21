import { useState } from 'react';
import { AppSidebar, type SidebarSection } from './AppSidebar';
import { PlaceholderPage } from './PlaceholderPage';
import { TeamsPage } from './TeamsPage';
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
  const [activeSection, setActiveSection] = useState<SidebarSection>('files');
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const workspaceState = useWorkspaces(workspaceService);
  const filesState = useFiles(fileService, workspaceState.currentWorkspace?.id ?? null);
  const currentSection = workspaceState.currentWorkspace ? activeSection : 'teams';

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

  async function createWorkspace(name: string) {
    await workspaceState.createWorkspace(name);
    setActiveSection('files');
  }

  function selectWorkspace(workspaceId: string) {
    workspaceState.selectWorkspace(workspaceId);
    setActiveSection('files');
  }

  let mainContent = (
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
  );

  if (currentSection === 'teams') {
    mainContent = (
      <TeamsPage
        currentWorkspace={workspaceState.currentWorkspace}
        error={workspaceState.error}
        isCreating={workspaceState.isCreating}
        isLoading={workspaceState.isLoading}
        onCreateWorkspace={createWorkspace}
        onSelectWorkspace={selectWorkspace}
        workspaces={workspaceState.workspaces}
      />
    );
  } else if (currentSection === 'recent') {
    mainContent = (
      <PlaceholderPage description="最近打开过的资料会显示在这里。" title="最近使用" />
    );
  } else if (currentSection === 'settings') {
    mainContent = <PlaceholderPage description="账户与偏好设置会放在这里。" title="设置" />;
  }

  return (
    <main className="shell">
      <div className="app-frame">
        <AppSidebar
          activeSection={currentSection}
          currentWorkspace={workspaceState.currentWorkspace}
          email={email}
          onNavigate={setActiveSection}
          onSignOutCurrentDevice={onSignOutCurrentDevice}
        />
        {mainContent}
      </div>
    </main>
  );
}
