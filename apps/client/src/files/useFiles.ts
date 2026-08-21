import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  FileOperationError,
  type FileOperationErrorKind,
  type FileService,
  type FileSummary
} from './fileService';

interface FilesState {
  canRetry: boolean;
  error: string | null;
  errorKind: FileOperationErrorKind | null;
  files: FileSummary[];
  isLoading: boolean;
  lastRefreshedAt: string | null;
  refreshFiles: () => Promise<void>;
  retry: () => Promise<void>;
}

function errorState(error: unknown): {
  canRetry: boolean;
  kind: FileOperationErrorKind;
  message: string;
} {
  if (error instanceof FileOperationError) {
    return { canRetry: error.canRetry, kind: error.kind, message: error.message };
  }

  return { canRetry: true, kind: 'unknown', message: '读取文件失败，请稍后重试' };
}

export function useFiles(
  fileService: FileService,
  workspaceId: string | null
): FilesState {
  const requestSequence = useRef(0);
  const [canRetry, setCanRetry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<FileOperationErrorKind | null>(null);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const refreshFiles = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!workspaceId) {
      setFiles([]);
      setError(null);
      setErrorKind(null);
      setCanRetry(false);
      setIsLoading(false);
      setLastRefreshedAt(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setErrorKind(null);
    setCanRetry(false);
    try {
      const nextFiles = await fileService.listFiles(workspaceId);
      if (requestId !== requestSequence.current) return;
      setFiles(nextFiles);
      setLastRefreshedAt(new Date().toISOString());
    } catch (caughtError) {
      if (requestId !== requestSequence.current) return;
      const nextError = errorState(caughtError);
      setFiles([]);
      setError(nextError.message);
      setErrorKind(nextError.kind);
      setCanRetry(nextError.canRetry);
    } finally {
      if (requestId === requestSequence.current) {
        setIsLoading(false);
      }
    }
  }, [fileService, workspaceId]);

  useLayoutEffect(() => {
    requestSequence.current += 1;
    setFiles([]);
    setError(null);
    setErrorKind(null);
    setCanRetry(false);
    setIsLoading(false);
    setLastRefreshedAt(null);
    void refreshFiles();
  }, [refreshFiles]);

  return {
    canRetry,
    error,
    errorKind,
    files,
    isLoading,
    lastRefreshedAt,
    refreshFiles,
    retry: refreshFiles
  };
}
