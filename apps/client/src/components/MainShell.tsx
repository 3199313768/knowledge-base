import { useEffect, useRef, useState } from 'react';
import { AppSidebar, type SidebarSection } from './AppSidebar';
import { PlaceholderPage } from './PlaceholderPage';
import { TeamsPage } from './TeamsPage';
import { WorkspaceDashboard } from './WorkspaceDashboard';
import { RecycleBinPage } from './RecycleBinPage';
import { useFiles } from '../files/useFiles';
import { useWorkspaces } from '../workspaces/useWorkspaces';
import { toFileOperationError, type FileService, type FileSummary } from '../files/fileService';
import type { SearchService } from '../search/searchService';
import type { SearchHistoryService } from '../search/searchHistoryService';
import type { UploadService } from '../uploads/uploadService';
import type { WorkspaceService } from '../workspaces/workspaceService';
import type { RecycleBinService } from '../files/recycleBinService';

interface MainShellProps {
  email: string;
  fileService: FileService;
  onSignOutCurrentDevice: () => Promise<void>;
  recycleBinService: RecycleBinService;
  searchHistoryService: SearchHistoryService;
  searchService: SearchService;
  uploadService: UploadService;
  workspaceService: WorkspaceService;
}

function actionError(action: string, error: unknown) {
  const operationError = toFileOperationError(error);
  return operationError.kind === 'unknown'
    ? `${action}失败，请稍后重试`
    : operationError.message;
}

export function MainShell({
  email,
  fileService,
  onSignOutCurrentDevice,
  recycleBinService,
  searchHistoryService,
  searchService,
  uploadService,
  workspaceService
}: MainShellProps) {
  const [activeSection, setActiveSection] = useState<SidebarSection>('files');
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const actionGenerationRef = useRef(0);
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const retryingFileIdsRef = useRef<Map<string, symbol>>(new Map());
  const workspaceGenerationRef = useRef(0);
  const workspaceState = useWorkspaces(workspaceService);
  const filesState = useFiles(fileService, workspaceState.currentWorkspace?.id ?? null);
  const activeWorkspaceId = workspaceState.currentWorkspace?.id ?? null;
  const currentSection = workspaceState.currentWorkspace ? activeSection : 'teams';

  useEffect(() => {
    if (activeWorkspaceIdRef.current === activeWorkspaceId) {
      return;
    }

    activeWorkspaceIdRef.current = activeWorkspaceId;
    workspaceGenerationRef.current += 1;
    actionGenerationRef.current += 1;
    retryingFileIdsRef.current = new Map();
    setFileActionError(null);
  }, [activeWorkspaceId]);

  function isCurrentAction(
    workspaceId: string,
    workspaceGeneration: number,
    actionGeneration: number
  ) {
    return (
      activeWorkspaceIdRef.current === workspaceId &&
      workspaceGenerationRef.current === workspaceGeneration &&
      actionGenerationRef.current === actionGeneration
    );
  }

  async function refreshFiles() {
    actionGenerationRef.current += 1;
    setFileActionError(null);
    await filesState.refreshFiles();
  }

  async function deleteFile(file: FileSummary) {
    if (!window.confirm(`确定删除“${file.displayName}”吗？`)) {
      return;
    }

    const workspaceId = activeWorkspaceIdRef.current;
    if (!workspaceId) {
      return;
    }
    const workspaceGeneration = workspaceGenerationRef.current;
    const actionGeneration = ++actionGenerationRef.current;
    setFileActionError(null);
    try {
      await fileService.softDeleteFile(file.id);
      if (!isCurrentAction(workspaceId, workspaceGeneration, actionGeneration)) {
        return;
      }
      await filesState.refreshFiles();
      if (isCurrentAction(workspaceId, workspaceGeneration, actionGeneration)) {
        setFileActionError(null);
      }
    } catch (caughtError) {
      if (isCurrentAction(workspaceId, workspaceGeneration, actionGeneration)) {
        setFileActionError(actionError('删除文件', caughtError));
      }
    }
  }

  async function retryFile(file: FileSummary) {
    const workspaceId = activeWorkspaceIdRef.current;
    if (
      !workspaceId ||
      !file.currentVersion?.id ||
      file.currentVersion.canRetry !== true ||
      retryingFileIdsRef.current.has(file.id)
    ) {
      return;
    }

    const workspaceGeneration = workspaceGenerationRef.current;
    const actionGeneration = ++actionGenerationRef.current;
    const operationToken = Symbol(file.id);
    setFileActionError(null);
    retryingFileIdsRef.current = new Map(retryingFileIdsRef.current).set(file.id, operationToken);
    try {
      await fileService.retryFileVersion(file.currentVersion.id);
      if (!isCurrentAction(workspaceId, workspaceGeneration, actionGeneration)) {
        return;
      }
      await filesState.refreshFiles();
      if (isCurrentAction(workspaceId, workspaceGeneration, actionGeneration)) {
        setFileActionError(null);
      }
    } catch (caughtError) {
      if (isCurrentAction(workspaceId, workspaceGeneration, actionGeneration)) {
        setFileActionError(actionError('重新处理', caughtError));
        throw caughtError;
      }
    } finally {
      if (retryingFileIdsRef.current.get(file.id) === operationToken) {
        const next = new Map(retryingFileIdsRef.current);
        next.delete(file.id);
        retryingFileIdsRef.current = next;
      }
    }
  }

  async function createWorkspace(name: string) {
    await workspaceState.createWorkspace(name);
    setActiveSection('files');
  }

  function selectWorkspace(workspaceId: string) {
    activeWorkspaceIdRef.current = workspaceId;
    workspaceGenerationRef.current += 1;
    actionGenerationRef.current += 1;
    retryingFileIdsRef.current = new Map();
    setFileActionError(null);
    workspaceState.selectWorkspace(workspaceId);
    setActiveSection('files');
  }

  let mainContent = (
    <WorkspaceDashboard
      currentWorkspace={workspaceState.currentWorkspace}
      fileActionError={fileActionError}
      fileLoadError={filesState.error}
      files={filesState.files}
      fileService={fileService}
      isLoadingFiles={filesState.isLoading}
      lastRefreshedAt={filesState.lastRefreshedAt}
      onDeleteFile={deleteFile}
      onPreviewFile={(file) => fileService.getFilePreviewUrl(file.id)}
      onRefreshFiles={refreshFiles}
      onRetryFile={retryFile}
      searchHistoryService={searchHistoryService}
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
  } else if (currentSection === 'recycle' && workspaceState.currentWorkspace) {
    mainContent = <RecycleBinPage currentWorkspace={workspaceState.currentWorkspace} service={recycleBinService} />;
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
