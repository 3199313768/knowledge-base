import { useRef, useState } from 'react';
import type { UploadService } from './uploadService';

export type BatchItemStatus = 'succeeded' | 'failed' | 'skipped';
export interface BatchItemResult { name: string; status: BatchItemStatus; message?: string; }
export interface BatchResult { failed: number; results: BatchItemResult[]; skipped: number; succeeded: number; }

export function useBatchUpload(service: UploadService, workspaceId: string, concurrency = 3) {
  const cancelled = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);

  async function run(files: File[]) {
    if (isRunning) return null;
    cancelled.current = false; setIsRunning(true);
    const results: BatchItemResult[] = new Array(files.length);
    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        const index = cursor++;
        const file = files[index];
        if (cancelled.current) { results[index] = { name: file.name, status: 'skipped', message: '已取消' }; continue; }
        try {
          const uploaded = await service.uploadFile({ file, workspaceId });
          results[index] = uploaded.outcome === 'duplicate'
            ? { name: file.name, status: 'skipped', message: '文件已存在' }
            : { name: file.name, status: 'succeeded' };
        } catch { results[index] = { name: file.name, status: 'failed', message: '上传失败，请稍后重试' }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
    const summary = { results, succeeded: results.filter(x => x.status === 'succeeded').length, failed: results.filter(x => x.status === 'failed').length, skipped: results.filter(x => x.status === 'skipped').length };
    setResult(summary); setIsRunning(false); return summary;
  }
  return { cancel: () => { cancelled.current = true; }, isRunning, result, run };
}
