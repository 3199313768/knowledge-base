import { StatusMessage } from '@oxygen-design/ui';
import { useId, useRef, useState } from 'react';
import { useUploadQueue } from '../uploads/useUploadQueue';
import { Button } from './ui/Button';
import type { UploadService } from '../uploads/uploadService';
import { useBatchUpload } from '../uploads/useBatchUpload';
import { BatchOperationSummary } from './BatchOperationSummary';

interface UploadPanelProps {
  onUploadSettled?: () => void;
  uploadService: UploadService;
  variant?: 'button' | 'dropzone';
  workspaceId: string;
}

export function UploadPanel({
  onUploadSettled,
  uploadService,
  variant = 'button',
  workspaceId
}: UploadPanelProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const uploadState = useUploadQueue(uploadService, workspaceId);
  const batchState = useBatchUpload(uploadService, workspaceId);

  async function submitFile(file: File | undefined) {
    if (!file || uploadState.isUploading) {
      return;
    }

    const result = await uploadState.uploadFile(file);
    if (result) {
      onUploadSettled?.();
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length <= 1) await submitFile(files[0]);
    else { const result = await batchState.run(files); if (result?.succeeded) onUploadSettled?.(); }
  }

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (event.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    await submitFile(event.dataTransfer.files?.[0]);
  }

  const statusMessages = (
    <>
      {uploadState.isUploading ? <div className="message"><StatusMessage>正在上传…</StatusMessage></div> : null}
      {uploadState.error ? (
        <div className="message message--error"><StatusMessage tone="error">{uploadState.error}</StatusMessage></div>
      ) : null}
      {uploadState.lastResult?.outcome === 'uploaded' && uploadState.lastFileName ? (
        <div className="message message--notice"><StatusMessage tone="success">上传完成：{uploadState.lastFileName}</StatusMessage></div>
      ) : null}
      {uploadState.lastResult?.outcome === 'duplicate' && uploadState.lastFileName ? (
        <div className="message message--notice"><StatusMessage tone="warning">文件已存在：{uploadState.lastFileName}</StatusMessage></div>
      ) : null}
    </>
  );

  const fileInput = (
    <input
      accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      aria-label="选择 PDF 或 DOCX"
      className="upload-input"
      disabled={uploadState.isUploading}
      id={inputId}
      onChange={handleFileChange}
      ref={inputRef}
      type="file"
      multiple
    />
  );

  if (variant === 'dropzone') {
    return (
      <div className="upload-panel upload-panel--dropzone">
        <label
          aria-label="拖拽上传 PDF 或 DOCX"
          className={
            isDragging ? 'upload-dropzone upload-dropzone--active' : 'upload-dropzone'
          }
          htmlFor={inputId}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={(event) => {
            void handleDrop(event);
          }}
        >
          <span className="upload-dropzone__icon" aria-hidden="true">
            ↑
          </span>
          <span className="upload-dropzone__title">拖拽或选择 PDF / DOCX</span>
        </label>
        {fileInput}
        {statusMessages}
      </div>
    );
  }

  return (
    <div className="upload-panel">
      <Button
        disabled={uploadState.isUploading}
        onClick={() => inputRef.current?.click()}
        variant="primary"
      >
        选择 PDF 或 DOCX
      </Button>
      {fileInput}
      {statusMessages}
      <BatchOperationSummary result={batchState.result} />
    </div>
  );
}
