import { useState } from 'react';
import type { FileService, FileSummary } from './fileService';
import type { BatchResult, BatchItemResult } from '../uploads/useBatchUpload';

export function useBatchFileOperations(service: FileService) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  async function run(files: FileSummary[], operation: 'retry' | 'delete') {
    if (isRunning) return null;
    setIsRunning(true);
    const results: BatchItemResult[] = [];
    for (const file of files) {
      if (operation === 'retry' && (!file.currentVersion?.id || file.currentVersion.canRetry !== true)) {
        results.push({ name: file.displayName, status: 'skipped', message: '当前不可重试' }); continue;
      }
      try {
        if (operation === 'retry') await service.retryFileVersion(file.currentVersion!.id);
        else await service.softDeleteFile(file.id);
        results.push({ name: file.displayName, status: 'succeeded' });
      } catch { results.push({ name: file.displayName, status: 'failed', message: '操作失败，请稍后重试' }); }
    }
    const summary = { results, succeeded: results.filter(x => x.status === 'succeeded').length, failed: results.filter(x => x.status === 'failed').length, skipped: results.filter(x => x.status === 'skipped').length };
    setResult(summary); setIsRunning(false); return summary;
  }
  return { isRunning, result, run };
}
