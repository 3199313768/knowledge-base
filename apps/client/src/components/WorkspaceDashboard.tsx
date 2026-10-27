import { EmptyState, StatusMessage } from '@oxygen-design/ui';
import { useEffect, useMemo, useState } from 'react';
import { FileListPanel } from './FileListPanel';
import { FileInspector } from './FileInspector';
import { SearchPanel } from './SearchPanel';
import { UploadPanel } from './UploadPanel';
import type { FileService, FileSummary } from '../files/fileService';
import type { SearchService } from '../search/searchService';
import type { SearchHistoryService } from '../search/searchHistoryService';
import type { UploadService } from '../uploads/uploadService';
import type { WorkspaceSummary } from '../workspaces/workspaceService';

interface WorkspaceDashboardProps {
  currentWorkspace: WorkspaceSummary | null;
  fileActionError: string | null;
  fileLoadError: string | null;
  files: FileSummary[];
  fileService: FileService;
  isLoadingFiles: boolean;
  lastRefreshedAt: string | null;
  onDeleteFile: (file: FileSummary) => Promise<void>;
  onPreviewFile: (file: FileSummary) => Promise<string>;
  onRefreshFiles: () => Promise<void>;
  onRetryFile: (file: FileSummary) => Promise<void>;
  searchHistoryService: SearchHistoryService;
  searchService: SearchService;
  uploadService: UploadService;
}

export function WorkspaceDashboard({
  currentWorkspace,
  fileActionError,
  fileLoadError,
  files,
  fileService,
  isLoadingFiles,
  lastRefreshedAt,
  onDeleteFile,
  onPreviewFile,
  onRefreshFiles,
  onRetryFile,
  searchHistoryService,
  searchService,
  uploadService
}: WorkspaceDashboardProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [fileSelectionError, setFileSelectionError] = useState<string | null>(null);
  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? files[0] ?? null,
    [files, selectedFileId]
  );
  const isEmpty = files.length === 0;

  function handleOpenFile(fileId: string) {
    if (!files.some((file) => file.id === fileId)) {
      setFileSelectionError('搜索结果对应的文件当前不可用，请刷新文件列表后重试。');
      return;
    }
    setFileSelectionError(null);
    setSelectedFileId(fileId);
  }

  useEffect(() => {
    if (files.length === 0) {
      if (selectedFileId !== null) {
        setSelectedFileId(null);
      }
      return;
    }

    if (!selectedFileId || !files.some((file) => file.id === selectedFileId)) {
      setSelectedFileId(files[0].id);
    }
  }, [files, selectedFileId]);

  if (!currentWorkspace) {
    return (
      <section className="content-pane">
        <div className="empty-state">
          <EmptyState
            description="资料、上传和搜索都会归属到当前团队。"
            title="请先创建或选择团队"
          />
        </div>
      </section>
    );
  }

  return (
    <section className="content-pane" aria-label="资料工作区">
      <div className={isEmpty ? 'workbench-grid workbench-grid--empty' : 'workbench-grid'}>
        <div className="workbench-main">
          <div className="workbench-command">
            <SearchPanel
              onOpenFile={handleOpenFile}
              searchHistoryService={searchHistoryService}
              searchService={searchService}
              workspaceId={currentWorkspace.id}
            />
            {!isEmpty ? (
              <UploadPanel
                onUploadSettled={onRefreshFiles}
                uploadService={uploadService}
                workspaceId={currentWorkspace.id}
              />
            ) : null}
          </div>

          {isEmpty ? (
            <section className="files-empty" aria-label="团队资料上传">
              {isLoadingFiles ? <StatusMessage>正在读取团队资料…</StatusMessage> : null}
              {!isLoadingFiles && fileLoadError ? (
                <StatusMessage tone="error">{fileLoadError}</StatusMessage>
              ) : null}
              {!isLoadingFiles && !fileLoadError ? (
                <div className="files-empty__intro">
                  <h2>还没有团队资料</h2>
                  <p>上传 PDF 或 DOCX。处理完成后就可以搜索。</p>
                </div>
              ) : null}
              <UploadPanel
                onUploadSettled={onRefreshFiles}
                uploadService={uploadService}
                variant="dropzone"
                workspaceId={currentWorkspace.id}
              />
            </section>
          ) : (
            <FileListPanel
              error={fileLoadError}
              fileService={fileService}
              files={files}
              isLoading={isLoadingFiles}
              lastRefreshedAt={lastRefreshedAt}
              onRefresh={onRefreshFiles}
              onRetryFile={onRetryFile}
              onSelectFile={setSelectedFileId}
              selectedFileId={selectedFile?.id ?? null}
            />
          )}
          {fileActionError ? (
            <StatusMessage tone="error">{fileActionError}</StatusMessage>
          ) : null}
        </div>

          {selectedFile ? (
          <FileInspector
            file={selectedFile}
            onDeleteFile={onDeleteFile}
            onPreviewFile={onPreviewFile}
            onRetryFile={onRetryFile}
          />
        ) : null}
        {fileSelectionError ? (
          <StatusMessage tone="error">{fileSelectionError}</StatusMessage>
        ) : null}
      </div>
    </section>
  );
}
