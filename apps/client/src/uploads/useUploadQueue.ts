import { useState } from 'react';
import {
  validateUploadFile,
  type UploadService,
  type UploadFileResult
} from './uploadService';

interface UploadQueueState {
  error: string | null;
  isUploading: boolean;
  lastFileName: string | null;
  lastResult: UploadFileResult | null;
  uploadFile: (file: File) => Promise<UploadFileResult | null>;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : '上传失败';
}

export function useUploadQueue(
  uploadService: UploadService,
  workspaceId: string
): UploadQueueState {
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<UploadFileResult | null>(null);

  async function uploadFile(file: File) {
    const validationError = validateUploadFile(file);
    setLastFileName(file.name);
    setLastResult(null);

    if (validationError) {
      setError(validationError);
      return null;
    }

    setIsUploading(true);
    setError(null);
    try {
      const result = await uploadService.uploadFile({ file, workspaceId });
      setLastResult(result);
      return result;
    } catch (caughtError) {
      setError(safeMessage(caughtError));
      return null;
    } finally {
      setIsUploading(false);
    }
  }

  return {
    error,
    isUploading,
    lastFileName,
    lastResult,
    uploadFile
  };
}
