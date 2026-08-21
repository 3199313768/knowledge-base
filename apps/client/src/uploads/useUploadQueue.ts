import { useEffect, useRef, useState } from 'react';
import {
  toFileOperationError,
  type FileOperationErrorKind
} from '../files/fileService';
import {
  validateUploadFile,
  type UploadService,
  type UploadFileResult
} from './uploadService';

interface UploadQueueState {
  error: string | null;
  isUploading: boolean;
  items: UploadItemState[];
  lastFileName: string | null;
  lastResult: UploadFileResult | null;
  uploadFile: (file: File) => Promise<UploadFileResult | null>;
}

export type UploadItemStatus = 'duplicate' | 'failed' | 'rejected' | 'uploaded' | 'uploading';

export interface UploadItemState {
  canRetry: boolean;
  duplicateFileId?: string;
  error: string | null;
  errorKind: FileOperationErrorKind | null;
  fileName: string;
  id: string;
  result: UploadFileResult | null;
  status: UploadItemStatus;
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function operationKey(workspaceId: string, file: File) {
  return `${workspaceId}:${fileKey(file)}`;
}

function itemFor(
  file: File,
  status: UploadItemStatus,
  overrides: Partial<Omit<UploadItemState, 'fileName' | 'id' | 'status'>> = {}
): UploadItemState {
  return {
    canRetry: false,
    error: null,
    errorKind: null,
    fileName: file.name,
    id: fileKey(file),
    result: null,
    status,
    ...overrides
  };
}

function uploadErrorMessage(error: { kind: FileOperationErrorKind; message: string }) {
  const messages: Record<FileOperationErrorKind, string> = {
    authentication: '登录状态已失效，请重新登录',
    configuration: '上传服务暂不可用，请检查应用配置后重试',
    conflict: '文件状态已变化，请刷新后重试',
    network: '网络异常，上传未完成，请检查网络后重试',
    not_found: '文件不存在或已被删除，请刷新文件列表',
    permission: '暂无权限上传当前团队资料，请确认团队权限',
    retry_limit: '已达到文件重试次数上限，请稍后联系管理员',
    unknown: '上传失败，请稍后重试',
    validation: error.message
  };

  return messages[error.kind];
}

export function useUploadQueue(
  uploadService: UploadService,
  workspaceId: string
): UploadQueueState {
  const activeUploadKeys = useRef(
    new Map<string, { generation: number; operationId: number }>()
  );
  const latestOperation = useRef(0);
  const workspaceGeneration = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [items, setItems] = useState<UploadItemState[]>([]);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<UploadFileResult | null>(null);

  useEffect(() => {
    workspaceGeneration.current += 1;
    latestOperation.current += 1;
    setError(null);
    setIsUploading(false);
    setItems([]);
    setLastFileName(null);
    setLastResult(null);
  }, [workspaceId]);

  async function uploadFile(file: File) {
    const generation = workspaceGeneration.current;
    const key = operationKey(workspaceId, file);
    const existingUpload = activeUploadKeys.current.get(key);
    if (existingUpload?.generation === generation) {
      return null;
    }
    const operationId = ++latestOperation.current;

    const isCurrentWorkspace = () => generation === workspaceGeneration.current;
    const isLatestOperation = () =>
      isCurrentWorkspace() && operationId === latestOperation.current;

    const validationError = validateUploadFile(file);
    if (isLatestOperation()) {
      setLastFileName(file.name);
      setLastResult(null);
    }

    if (validationError) {
      if (isCurrentWorkspace()) {
        setError(validationError);
        setItems((current) => [
          ...current.filter((item) => item.id !== fileKey(file)),
          itemFor(file, 'rejected', {
            error: validationError,
            errorKind: 'validation'
          })
        ]);
      }
      return null;
    }

    activeUploadKeys.current.set(key, { generation, operationId });
    if (isCurrentWorkspace()) {
      setIsUploading(true);
      setError(null);
    }
    setItems((current) => [
      ...current.filter((item) => item.id !== fileKey(file)),
      itemFor(file, 'uploading')
    ]);
    try {
      const result = await uploadService.uploadFile({ file, workspaceId });
      if (isCurrentWorkspace()) {
        if (isLatestOperation()) {
          setLastResult(result);
        }
        setItems((current) => [
          ...current.filter((item) => item.id !== fileKey(file)),
          itemFor(file, result.outcome === 'duplicate' ? 'duplicate' : 'uploaded', {
            duplicateFileId: result.outcome === 'duplicate' ? result.duplicateFileId : undefined,
            result
          })
        ]);
      }
      return result;
    } catch (caughtError) {
      const operationError = toFileOperationError(caughtError);
      const nextErrorMessage = uploadErrorMessage(operationError);
      if (isCurrentWorkspace()) {
        if (isLatestOperation()) {
          setError(nextErrorMessage);
        }
        setItems((current) => [
          ...current.filter((item) => item.id !== fileKey(file)),
          itemFor(file, 'failed', {
            canRetry: operationError.canRetry,
            error: nextErrorMessage,
            errorKind: operationError.kind
          })
        ]);
      }
      return null;
    } finally {
      const activeUpload = activeUploadKeys.current.get(key);
      if (
        activeUpload?.generation === generation &&
        activeUpload.operationId === operationId
      ) {
        activeUploadKeys.current.delete(key);
      }
      if (isCurrentWorkspace() && activeUploadKeys.current.get(key) === undefined) {
        setIsUploading(
          Array.from(activeUploadKeys.current.values()).some(
            (activeOperation) => activeOperation.generation === generation
          )
        );
      }
    }
  }

  return {
    error,
    isUploading,
    items,
    lastFileName,
    lastResult,
    uploadFile
  };
}
