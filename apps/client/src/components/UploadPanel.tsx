import { useId, useRef, useState } from 'react';
import { useUploadQueue } from '../uploads/useUploadQueue';
import { Button } from './ui/Button';
import type { UploadService } from '../uploads/uploadService';

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
    const file = event.target.files?.[0];
    event.target.value = '';
    await submitFile(file);
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
      {uploadState.isUploading ? <p className="message">正在上传…</p> : null}
      {uploadState.error ? (
        <p className="message message--error">{uploadState.error}</p>
      ) : null}
      {uploadState.lastResult?.outcome === 'uploaded' && uploadState.lastFileName ? (
        <p className="message message--notice">上传完成：{uploadState.lastFileName}</p>
      ) : null}
      {uploadState.lastResult?.outcome === 'duplicate' && uploadState.lastFileName ? (
        <p className="message message--notice">文件已存在：{uploadState.lastFileName}</p>
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
    </div>
  );
}
