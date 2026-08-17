import { FileListPanel } from './FileListPanel';
import { SearchPanel } from './SearchPanel';
import { UploadPanel } from './UploadPanel';
import { Card } from './ui/Card';
import { summarizeFileStatuses, type FileSummary } from '../files/fileService';
import type { SearchService } from '../search/searchService';
import type { UploadService } from '../uploads/uploadService';
import type { WorkspaceSummary } from '../workspaces/workspaceService';

interface WorkspaceDashboardProps {
  currentWorkspace: WorkspaceSummary | null;
  fileError: string | null;
  files: FileSummary[];
  isLoadingFiles: boolean;
  lastRefreshedAt: string | null;
  onDeleteFile: (file: FileSummary) => Promise<void>;
  onRefreshFiles: () => Promise<void>;
  onRetryFile: (file: FileSummary) => Promise<void>;
  searchService: SearchService;
  uploadService: UploadService;
}

export function WorkspaceDashboard({
  currentWorkspace,
  fileError,
  files,
  isLoadingFiles,
  lastRefreshedAt,
  onDeleteFile,
  onRefreshFiles,
  onRetryFile,
  searchService,
  uploadService
}: WorkspaceDashboardProps) {
  const summary = summarizeFileStatuses(files);

  if (!currentWorkspace) {
    return (
      <section className="content-pane">
        <header className="workbench-header">
          <div>
            <p className="eyebrow">Documents</p>
            <h2>知识库工作台</h2>
          </div>
        </header>
        <Card className="empty-state" variant="dashed">
          <div className="empty-state__icon" aria-hidden="true">
            ↑
          </div>
          <h2>请先创建或选择团队</h2>
          <p>资料、上传和搜索都会归属到当前团队。</p>
        </Card>
      </section>
    );
  }

  return (
    <section className="content-pane">
      <header className="workbench-header">
        <div>
          <p className="eyebrow">Documents</p>
          <h2>知识库工作台</h2>
          <p>当前页面：资料</p>
        </div>
        <p className="workspace-current">当前团队：{currentWorkspace.name}</p>
      </header>

      <div className="status-grid" aria-label="当前团队状态">
        <Card className="status-card">
          <span>文件</span>
          <strong>{summary.total}</strong>
        </Card>
        <Card className="status-card">
          <span>待处理</span>
          <strong>{summary.processing}</strong>
        </Card>
        <Card className="status-card">
          <span>可搜索</span>
          <strong>{summary.searchable}</strong>
        </Card>
        <Card className="status-card">
          <span>失败</span>
          <strong>{summary.failed}</strong>
        </Card>
      </div>

      <div className="workspace-content">
        <UploadPanel
          onUploadSettled={onRefreshFiles}
          uploadService={uploadService}
          workspaceId={currentWorkspace.id}
        />
        <SearchPanel searchService={searchService} workspaceId={currentWorkspace.id} />
        <FileListPanel
          error={fileError}
          files={files}
          isLoading={isLoadingFiles}
          lastRefreshedAt={lastRefreshedAt}
          onDeleteFile={onDeleteFile}
          onRefresh={onRefreshFiles}
          onRetryFile={onRetryFile}
        />
      </div>
    </section>
  );
}
