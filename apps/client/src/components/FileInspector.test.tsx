import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileInspector } from './FileInspector';

const baseFile = {
  currentVersion: {
    id: 'version-a',
    mimeType: 'application/pdf',
    sizeBytes: 1536,
    status: 'searchable' as const
  },
  displayName: '产品方案.pdf',
  id: 'file-a',
  updatedAt: '2026-08-17T06:00:00.000Z'
};

afterEach(() => {
  cleanup();
});

describe('FileInspector preview', () => {
  it('creates a protected download link for a DOCX file', async () => {
    const onPreviewFile = vi.fn(async () => 'https://storage.example.test/docx-download');
    render(
      <FileInspector
        file={{
          ...baseFile,
          currentVersion: {
            ...baseFile.currentVersion,
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          },
          displayName: '产品方案.docx'
        }}
        onDeleteFile={vi.fn(async () => undefined)}
        onPreviewFile={onPreviewFile}
        onRetryFile={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByText('DOCX 文件暂不支持内嵌预览，请下载后使用文档应用打开。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '准备 DOCX 下载链接' }));

    const link = await screen.findByRole('link', { name: '下载并打开 DOCX' });
    expect(link).toHaveAttribute('href', 'https://storage.example.test/docx-download');
    expect(link).toHaveAttribute('download', '产品方案.docx');
    expect(link).toHaveAttribute('target', '_blank');
    expect(onPreviewFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-a' }));
  });

  it('shows a safe error when PDF preview URL creation is denied', async () => {
    render(
      <FileInspector
        file={baseFile}
        onDeleteFile={vi.fn(async () => undefined)}
        onPreviewFile={vi.fn(async () => {
          throw new Error('storage permission denied');
        })}
        onRetryFile={vi.fn(async () => undefined)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '生成 PDF 预览链接' }));

    expect(
      await screen.findByText('文件预览暂不可用，请检查文件权限或稍后重试')
    ).toBeInTheDocument();
    expect(screen.queryByText('storage permission denied')).not.toBeInTheDocument();
  });

  it('ignores a stale preview URL after the selected file changes', async () => {
    let resolvePreview: ((url: string) => void) | undefined;
    const onPreviewFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvePreview = resolve;
        })
    );
    const inspectorProps = {
      onDeleteFile: vi.fn(async () => undefined),
      onPreviewFile,
      onRetryFile: vi.fn(async () => undefined)
    };
    const { rerender } = render(<FileInspector {...inspectorProps} file={baseFile} />);

    fireEvent.click(screen.getByRole('button', { name: '生成 PDF 预览链接' }));
    rerender(
      <FileInspector
        {...inspectorProps}
        file={{ ...baseFile, displayName: '更新后的产品方案.pdf', id: 'file-b' }}
      />
    );

    await act(async () => {
      resolvePreview?.('https://storage.example.test/stale-file-a');
    });

    expect(screen.queryByRole('link', { name: '在新窗口打开 PDF' })).not.toBeInTheDocument();
  });

  it('ignores a stale preview URL when the same file receives a new current version', async () => {
    let resolvePreview: ((url: string) => void) | undefined;
    const onPreviewFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvePreview = resolve;
        })
    );
    const inspectorProps = {
      onDeleteFile: vi.fn(async () => undefined),
      onPreviewFile,
      onRetryFile: vi.fn(async () => undefined)
    };
    const { rerender } = render(<FileInspector {...inspectorProps} file={baseFile} />);

    fireEvent.click(screen.getByRole('button', { name: '生成 PDF 预览链接' }));
    rerender(
      <FileInspector
        {...inspectorProps}
        file={{
          ...baseFile,
          currentVersion: { ...baseFile.currentVersion, id: 'version-b' }
        }}
      />
    );

    await act(async () => {
      resolvePreview?.('https://storage.example.test/stale-version-a');
    });

    expect(screen.queryByRole('link', { name: '在新窗口打开 PDF' })).not.toBeInTheDocument();
  });
});
