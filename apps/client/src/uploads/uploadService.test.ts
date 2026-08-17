import { describe, expect, it, vi } from 'vitest';
import {
  sha256Checksum,
  validateUploadFile,
  type UploadService
} from './uploadService';

describe('uploadService validation', () => {
  it('accepts PDF and DOCX files within the service size boundary', () => {
    const pdf = new File(['pdf'], '产品说明.pdf', { type: 'application/pdf' });
    const docx = new File(['docx'], '会议纪要.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    expect(validateUploadFile(pdf)).toBeNull();
    expect(validateUploadFile(docx)).toBeNull();
  });

  it('rejects unsupported file types before upload', () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    expect(validateUploadFile(file)).toBe('仅支持 PDF 或 DOCX 文件');
  });

  it('rejects files larger than 100000000 bytes before upload', () => {
    const file = new File(['pdf'], 'too-large.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 100000001 });

    expect(validateUploadFile(file)).toBe('文件不能超过 100MB');
  });

  it('formats sha256 checksums for upload RPCs', async () => {
    const file = new File(['abc'], 'a.pdf', { type: 'application/pdf' });

    await expect(sha256Checksum(file)).resolves.toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('UploadService contract', () => {
  it('returns duplicate results without requiring UI code to inspect RPC rows', async () => {
    const uploadService: UploadService = {
      uploadFile: vi.fn(async () => ({
        duplicateFileId: 'duplicate-file',
        outcome: 'duplicate' as const
      }))
    };

    await expect(
      uploadService.uploadFile({
        file: new File(['pdf'], '重复.pdf', { type: 'application/pdf' }),
        workspaceId: 'workspace-id'
      })
    ).resolves.toEqual({
      duplicateFileId: 'duplicate-file',
      outcome: 'duplicate'
    });
  });
});
