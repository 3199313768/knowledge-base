import { describe, expect, it } from 'vitest';
import { RecycleBinServiceError } from './recycleBinService';

describe('RecycleBinServiceError', () => {
  it('keeps stable user-safe error kinds', () => {
    const error = new RecycleBinServiceError('文件当前正在清理，请稍后重试。', 'conflict');
    expect(error.kind).toBe('conflict');
    expect(error.message).not.toContain('permission denied');
  });
});
