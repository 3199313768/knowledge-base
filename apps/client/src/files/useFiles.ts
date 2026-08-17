import { useCallback, useEffect, useState } from 'react';
import type { FileService, FileSummary } from './fileService';

interface FilesState {
  error: string | null;
  files: FileSummary[];
  isLoading: boolean;
  lastRefreshedAt: string | null;
  refreshFiles: () => Promise<void>;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : '文件操作失败';
}

export function useFiles(
  fileService: FileService,
  workspaceId: string | null
): FilesState {
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const refreshFiles = useCallback(async () => {
    if (!workspaceId) {
      setFiles([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      setFiles(await fileService.listFiles(workspaceId));
      setLastRefreshedAt(new Date().toISOString());
    } catch (caughtError) {
      setFiles([]);
      setError(`读取文件失败：${safeMessage(caughtError)}`);
    } finally {
      setIsLoading(false);
    }
  }, [fileService, workspaceId]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  return {
    error,
    files,
    isLoading,
    lastRefreshedAt,
    refreshFiles
  };
}
