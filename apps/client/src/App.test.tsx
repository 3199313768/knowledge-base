import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { AuthService } from './auth/authService';
import type { FileService, FileSummary } from './files/fileService';
import type { SearchService } from './search/searchService';
import type { SearchHistoryService } from './search/searchHistoryService';
import type { UploadService } from './uploads/uploadService';
import type { WorkspaceService, WorkspaceSummary } from './workspaces/workspaceService';

function sessionFor(email: string): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: 'user-id',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
      email
    }
  };
}

function createAuthService(initialSession: Session | null = null) {
  let session = initialSession;
  let listener: ((nextSession: Session | null) => void) | undefined;
  const unsubscribe = vi.fn();
  const authService: AuthService = {
    getCurrentSession: vi.fn(async () => session),
    onSessionChange: vi.fn((onChange) => {
      listener = onChange;
      return { unsubscribe };
    }),
    signInWithPassword: vi.fn(async ({ email }) => {
      session = sessionFor(email);
      listener?.(session);
    }),
    signUpWithPassword: vi.fn(async ({ email }) => {
      session = sessionFor(email);
      listener?.(session);
      return { needsEmailConfirmation: false };
    }),
    signOutCurrentDevice: vi.fn(async () => {
      session = null;
      listener?.(null);
    })
  };
  return { authService, unsubscribe };
}

function createWorkspaceService(initialWorkspaces: WorkspaceSummary[] = []) {
  let workspaces = initialWorkspaces;
  const workspaceService: WorkspaceService = {
    listWorkspaces: vi.fn(async () => workspaces),
    createWorkspace: vi.fn(async (name) => {
      const workspace = {
        id: `${workspaces.length + 1}`,
        name,
        createdAt: new Date().toISOString()
      };
      workspaces = [workspace, ...workspaces];
      return workspace.id;
    })
  };

  return { workspaceService };
}

function createUploadService() {
  const uploadService: UploadService = {
    uploadFile: vi.fn(async () => ({
      fileId: 'file-id',
      outcome: 'uploaded' as const,
      versionId: 'version-id'
    }))
  };

  return { uploadService };
}

function createFileService(initialFiles: FileSummary[] = []) {
  let files = initialFiles;
  const fileService: FileService = {
    getFilePreviewUrl: vi.fn(async () => 'https://storage.example.test/preview'),
    listFiles: vi.fn(async () => files),
    retryFileVersion: vi.fn(async () => undefined),
    softDeleteFile: vi.fn(async (fileId) => {
      files = files.filter((file) => file.id !== fileId);
    })
  };

  return {
    fileService,
    setFiles(nextFiles: FileSummary[]) {
      files = nextFiles;
    }
  };
}

function createSearchService() {
  const searchService: SearchService = {
    search: vi.fn(async () => [
      {
        fileId: 'file-a',
        fileName: '产品方案.pdf',
        score: 0.42,
        snippet: '年度报价策略',
        sourceLabel: '第 3 页'
      }
    ])
  };

  return { searchService };
}

function createSearchHistoryService() {
  const searchHistoryService: SearchHistoryService = {
    list: vi.fn(async () => [
      {
        id: 'history-a',
        query: '历史查询',
        createdAt: '2026-08-21T08:00:00.000Z',
        updatedAt: '2026-08-21T09:00:00.000Z'
      }
    ]),
    record: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined)
  };

  return { searchHistoryService };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App Phase 3 auth shell', () => {
  it('shows the email and password login form by default', async () => {
    const { authService } = createAuthService();

    render(<App authService={authService} />);

    expect(await screen.findByRole('heading', { name: '登录知识库' })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('switches to sign up mode and submits registration', async () => {
    const { authService } = createAuthService();

    render(<App authService={authService} />);
    await screen.findByRole('heading', { name: '登录知识库' });

    fireEvent.click(screen.getByRole('button', { name: '注册新账号' }));
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'new@example.test' }
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'password123' }
    });
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }));

    await waitFor(() => {
      expect(authService.signUpWithPassword).toHaveBeenCalledWith({
        email: 'new@example.test',
        password: 'password123'
      });
    });
    expect(await screen.findByText('new@example.test')).toBeInTheDocument();
  });

  it('shows email confirmation guidance when sign up returns no session', async () => {
    const { authService } = createAuthService();
    vi.mocked(authService.signUpWithPassword).mockResolvedValueOnce({
      needsEmailConfirmation: true
    });

    render(<App authService={authService} />);
    await screen.findByRole('heading', { name: '登录知识库' });

    fireEvent.click(screen.getByRole('button', { name: '注册新账号' }));
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'confirm@example.test' }
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'password123' }
    });
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }));

    expect(
      await screen.findByText('账号已创建，请检查邮箱完成确认。')
    ).toBeInTheDocument();
  });

  it('signs in and then signs out only the current device from the main shell', async () => {
    const { authService } = createAuthService();

    render(<App authService={authService} />);
    await screen.findByRole('heading', { name: '登录知识库' });

    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'me@example.test' }
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'password123' }
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('me@example.test')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '退出当前设备' }));

    await waitFor(() => {
      expect(authService.signOutCurrentDevice).toHaveBeenCalled();
    });
    expect(await screen.findByRole('heading', { name: '登录知识库' })).toBeInTheDocument();
  });

  it('allows current-device sign out from the auth page when an existing local session is present', async () => {
    const { authService } = createAuthService(sessionFor('local@example.test'));

    render(<App authService={authService} forceAuthPage />);
    await screen.findByRole('heading', { name: '登录知识库' });

    fireEvent.click(screen.getByRole('button', { name: '退出当前设备' }));

    await waitFor(() => {
      expect(authService.signOutCurrentDevice).toHaveBeenCalled();
    });
  });

  it('cleans up the auth state subscription on unmount', async () => {
    const { authService, unsubscribe } = createAuthService();

    const { unmount } = render(<App authService={authService} />);
    await screen.findByRole('heading', { name: '登录知识库' });
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('shows a safe configuration error when Supabase client config is missing', async () => {
    const brokenAuthService: AuthService = {
      getCurrentSession: vi.fn(async () => {
        throw new Error('Supabase 客户端配置缺失');
      }),
      onSessionChange: vi.fn(() => ({ unsubscribe: vi.fn() })),
      signInWithPassword: vi.fn(),
      signUpWithPassword: vi.fn(),
      signOutCurrentDevice: vi.fn()
    };

    render(<App authService={brokenAuthService} />);

    expect(
      await screen.findByText('Supabase 客户端配置缺失')
    ).toBeInTheDocument();
  });

  it('shows a safe configuration error when auth subscription setup fails', async () => {
    const brokenAuthService: AuthService = {
      getCurrentSession: vi.fn(async () => null),
      onSessionChange: vi.fn(() => {
        throw new Error('Supabase 客户端配置缺失');
      }),
      signInWithPassword: vi.fn(),
      signUpWithPassword: vi.fn(),
      signOutCurrentDevice: vi.fn()
    };

    render(<App authService={brokenAuthService} />);

    expect(
      await screen.findByText('Supabase 客户端配置缺失')
    ).toBeInTheDocument();
  });

  it('loads workspaces after sign in and shows the empty team creation entry', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService();

    render(<App authService={authService} workspaceService={workspaceService} />);

    expect(await screen.findByText('owner@example.test')).toBeInTheDocument();
    expect(workspaceService.listWorkspaces).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: '创建你的第一个团队' })).toBeInTheDocument();
    expect(screen.getByLabelText('团队名称')).toBeInTheDocument();
  });

  it('creates a workspace and selects it as the current team', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService();

    render(<App authService={authService} workspaceService={workspaceService} />);
    await screen.findByRole('heading', { name: '创建你的第一个团队' });

    fireEvent.change(screen.getByLabelText('团队名称'), {
      target: { value: '产品知识库' }
    });
    fireEvent.click(screen.getByRole('button', { name: '创建团队' }));

    await waitFor(() => {
      expect(workspaceService.createWorkspace).toHaveBeenCalledWith('产品知识库');
    });
    expect(await screen.findByRole('button', { name: '当前团队 产品知识库' })).toBeInTheDocument();
  });

  it('selects an existing workspace from the workspace list', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' },
      { id: 'workspace-b', name: '运营团队', createdAt: '2026-08-16T00:00:00.000Z' }
    ]);

    render(<App authService={authService} workspaceService={workspaceService} />);

    expect(await screen.findByRole('button', { name: '当前团队 研发团队' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '团队小组' }));
    fireEvent.click(screen.getByRole('button', { name: '运营团队' }));

    expect(await screen.findByRole('button', { name: '当前团队 运营团队' })).toBeInTheDocument();
  });

  it('shows a workspace loading error without breaking current-device sign out', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const workspaceService: WorkspaceService = {
      listWorkspaces: vi.fn(async () => {
        throw new Error('workspace membership required');
      }),
      createWorkspace: vi.fn()
    };

    render(<App authService={authService} workspaceService={workspaceService} />);

    expect(await screen.findByText('读取团队失败：workspace membership required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退出当前设备' }));

    await waitFor(() => {
      expect(authService.signOutCurrentDevice).toHaveBeenCalled();
    });
  });

  it('does not show the upload entry before a workspace is selected', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService();
    const { uploadService } = createUploadService();

    render(
      <App
        authService={authService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('heading', { name: '创建你的第一个团队' })).toBeInTheDocument();
    expect(screen.queryByLabelText('选择 PDF 或 DOCX')).not.toBeInTheDocument();
  });

  it('uploads a PDF into the selected workspace', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    const input = await screen.findByLabelText('选择 PDF 或 DOCX');
    const file = new File(['%PDF-1.4\n'], '方案.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadService.uploadFile).toHaveBeenCalledWith({
        file,
        workspaceId: 'workspace-a'
      });
    });
    expect(await screen.findByText('上传完成：方案.pdf')).toBeInTheDocument();
  });

  it('rejects unsupported upload files before calling the upload service', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    const input = await screen.findByLabelText('选择 PDF 或 DOCX');
    fireEvent.change(input, {
      target: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] }
    });

    expect(await screen.findByText('仅支持 PDF 或 DOCX 文件')).toBeInTheDocument();
    expect(uploadService.uploadFile).not.toHaveBeenCalled();
  });

  it('shows duplicate upload guidance without treating it as an error', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();
    vi.mocked(uploadService.uploadFile).mockResolvedValueOnce({
      duplicateFileId: 'duplicate-file',
      outcome: 'duplicate'
    });

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    const input = await screen.findByLabelText('选择 PDF 或 DOCX');
    fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.4\n'], '已有.pdf', { type: 'application/pdf' })] }
    });

    expect(await screen.findByText('文件已存在：已有.pdf')).toBeInTheDocument();
  });

  it('shows current workspace files with processing status', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-a',
        displayName: '产品方案.pdf',
        currentVersion: {
          id: 'version-a',
          mimeType: 'application/pdf',
          sizeBytes: 1536,
          status: 'pending_processing'
        },
        updatedAt: '2026-08-17T06:00:00.000Z'
      }
    ]);

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('button', { name: '查看 产品方案.pdf' })).toBeInTheDocument();
    expect(screen.getAllByText('等待处理').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.5 KB').length).toBeGreaterThan(0);
    expect(fileService.listFiles).toHaveBeenCalledWith('workspace-a');
  });

  it('shows the macOS workbench sidebar navigation after selecting a workspace', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('navigation', { name: '应用导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '所有文件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最近使用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '团队小组' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '当前团队 研发团队' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '资料工作区' })).toBeInTheDocument();
    expect(screen.queryByText('Mac + iPhone 私有资料工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('当前页面：资料')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('当前团队状态')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('团队名称')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建团队' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '团队小组' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '团队小组' }));
    expect(screen.getByRole('region', { name: '团队小组' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建团队' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '最近使用' }));
    expect(screen.getByRole('region', { name: '最近使用' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByRole('region', { name: '设置' })).toBeInTheDocument();
  });

  it('shows the A1 Finder inspector workbench layout after selecting a workspace', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-a',
        displayName: '产品方案.pdf',
        currentVersion: {
          id: 'version-a',
          mimeType: 'application/pdf',
          sizeBytes: 1536,
          status: 'searchable'
        },
        updatedAt: '2026-08-17T06:00:00.000Z'
      }
    ]);

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('region', { name: '资料工作区' })).toBeInTheDocument();
    expect(await screen.findByRole('complementary', { name: '文件检查器' })).toBeInTheDocument();
    expect(screen.getByLabelText('搜索当前团队资料')).toBeInTheDocument();
    expect(screen.getByLabelText('选择 PDF 或 DOCX')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '产品方案.pdf' })).toBeInTheDocument();
    expect(screen.queryByText('version-a')).not.toBeInTheDocument();
    expect(screen.queryByText('application/pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('打开详情')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除 产品方案.pdf' })).not.toBeInTheDocument();
  });

  it('hides explanatory copy inside search and upload entry cards', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    await screen.findByRole('region', { name: '资料工作区' });
    expect(
      screen.queryByText('在当前团队已处理的资料中查找匹配片段。')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('选择一个 PDF 或 DOCX，文件会归属到当前团队。')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('搜索资料')).not.toBeInTheDocument();
    expect(screen.queryByText('上传资料')).not.toBeInTheDocument();
  });

  it('updates the inspector when a file is selected from the Finder list', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-ready',
        displayName: '产品方案.pdf',
        currentVersion: {
          id: 'version-ready',
          mimeType: 'application/pdf',
          sizeBytes: 1536,
          status: 'searchable'
        },
        updatedAt: '2026-08-17T06:00:00.000Z'
      },
      {
        id: 'file-failed',
        displayName: '访谈记录.pdf',
        currentVersion: {
          id: 'version-failed',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          status: 'failed'
        },
        updatedAt: '2026-08-17T07:00:00.000Z'
      }
    ]);

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('heading', { name: '产品方案.pdf' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看 访谈记录.pdf' }));

    expect(screen.getByRole('heading', { name: '访谈记录.pdf' })).toBeInTheDocument();
    expect(screen.queryByText('version-failed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新处理选中文件' })).toBeInTheDocument();
  });

  it('keeps current-device sign out in the workbench account area', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByText('owner@example.test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '退出当前设备' }));

    await waitFor(() => {
      expect(authService.signOutCurrentDevice).toHaveBeenCalled();
    });
  });

  it('shows an empty file list state for a selected workspace without files', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByText('拖拽或选择 PDF / DOCX')).toBeInTheDocument();
    expect(screen.queryByText('还没有资料')).not.toBeInTheDocument();
    expect(screen.queryByText('上传后会在这里显示处理状态，并可用于搜索。')).not.toBeInTheDocument();
    expect(screen.getByLabelText('选择 PDF 或 DOCX')).toBeInTheDocument();
    expect(screen.getByLabelText('搜索当前团队资料')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '文件检查器' })).not.toBeInTheDocument();
  });

  it('uploads a PDF by dragging it onto the empty dropzone', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    const dropzone = await screen.findByLabelText('拖拽上传 PDF 或 DOCX');
    const file = new File(['%PDF-1.4\n'], '拖拽方案.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] }
    });

    await waitFor(() => {
      expect(uploadService.uploadFile).toHaveBeenCalledWith({
        file,
        workspaceId: 'workspace-a'
      });
    });
    expect(await screen.findByText('上传完成：拖拽方案.pdf')).toBeInTheDocument();
  });

  it('shows file list load errors without breaking upload entry', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const fileService: FileService = {
      getFilePreviewUrl: vi.fn(async () => 'https://storage.example.test/preview'),
      listFiles: vi.fn(async () => {
        throw new Error('workspace membership required');
      }),
      retryFileVersion: vi.fn(async () => undefined),
      softDeleteFile: vi.fn(async () => undefined)
    };

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByText('读取文件失败：workspace membership required')).toBeInTheDocument();
    expect(screen.getByLabelText('选择 PDF 或 DOCX')).toBeInTheDocument();
    expect(screen.queryByText('还没有资料')).not.toBeInTheDocument();
  });

  it('refreshes the file list after a successful upload', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService, setFiles } = createFileService();
    vi.mocked(uploadService.uploadFile).mockImplementationOnce(async () => {
      setFiles([
        {
          id: 'file-new',
          displayName: '新资料.pdf',
          currentVersion: {
            id: 'version-new',
            mimeType: 'application/pdf',
            sizeBytes: 12,
            status: 'pending_processing'
          },
          updatedAt: '2026-08-17T07:00:00.000Z'
        }
      ]);
      return {
        fileId: 'file-new',
        outcome: 'uploaded' as const,
        versionId: 'version-new'
      };
    });

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByText('拖拽或选择 PDF / DOCX')).toBeInTheDocument();

    const input = screen.getByLabelText('选择 PDF 或 DOCX');
    fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.4\n'], '新资料.pdf', { type: 'application/pdf' })] }
    });

    expect(await screen.findByRole('button', { name: '查看 新资料.pdf' })).toBeInTheDocument();
    expect(fileService.listFiles).toHaveBeenCalledTimes(2);
  });

  it('shows a status summary and last refresh time for current workspace files', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-processing',
        displayName: '处理中.pdf',
        currentVersion: {
          id: 'version-processing',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          status: 'processing'
        },
        updatedAt: '2026-08-17T06:00:00.000Z'
      },
      {
        id: 'file-searchable',
        displayName: '可搜索.pdf',
        currentVersion: {
          id: 'version-searchable',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          status: 'searchable'
        },
        updatedAt: '2026-08-17T07:00:00.000Z'
      },
      {
        id: 'file-failed',
        displayName: '失败.pdf',
        currentVersion: {
          id: 'version-failed',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          status: 'failed'
        },
        updatedAt: '2026-08-17T08:00:00.000Z'
      }
    ]);

    render(
      <App
        authService={authService}
        fileService={fileService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByText(/共 3 个/)).toBeInTheDocument();
    expect(screen.getByText(/待处理 1/)).toBeInTheDocument();
    expect(screen.getByText(/可搜索 1/)).toBeInTheDocument();
    expect(screen.getByText(/失败 1/)).toBeInTheDocument();
    expect(screen.getByText(/最后刷新：/)).toBeInTheDocument();
  });

  it('searches files in the selected workspace and shows result snippets', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-a',
        displayName: '产品方案.pdf',
        currentVersion: {
          id: 'version-a',
          mimeType: 'application/pdf',
          sizeBytes: 1536,
          status: 'searchable'
        },
        updatedAt: '2026-08-17T06:00:00.000Z'
      }
    ]);
    const { searchService } = createSearchService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        searchService={searchService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    const input = await screen.findByLabelText('搜索当前团队资料');
    fireEvent.change(input, { target: { value: '报价' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    await waitFor(() => {
      expect(searchService.search).toHaveBeenCalledWith({
        query: '报价',
        workspaceId: 'workspace-a'
      });
    });
    expect(await screen.findByText('年度报价策略')).toBeInTheDocument();
    expect(screen.getByText('第 3 页')).toBeInTheDocument();
    expect(screen.queryByText('0.420')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开文件 产品方案.pdf' }));
    expect(screen.getByRole('heading', { name: '产品方案.pdf', level: 2 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成 PDF 预览链接' }));
    expect(await screen.findByRole('link', { name: '在新窗口打开 PDF' })).toHaveAttribute(
      'href',
      'https://storage.example.test/preview'
    );
    expect(fileService.getFilePreviewUrl).toHaveBeenCalledWith('file-a');
  });

  it('shows search empty state when no results are returned', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-a',
        displayName: '产品方案.pdf',
        currentVersion: {
          id: 'version-a',
          mimeType: 'application/pdf',
          sizeBytes: 1536,
          status: 'searchable'
        },
        updatedAt: '2026-08-17T06:00:00.000Z'
      }
    ]);
    const { searchService } = createSearchService();
    vi.mocked(searchService.search).mockResolvedValueOnce([]);

    render(
      <App
        authService={authService}
        fileService={fileService}
        searchService={searchService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    const input = await screen.findByLabelText('搜索当前团队资料');
    fireEvent.change(input, { target: { value: '不存在的内容' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));

    expect(await screen.findByText('没有找到匹配资料')).toBeInTheDocument();
  });

  it('re-runs a selected search history item from the workspace dashboard', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService();
    const { searchService } = createSearchService();
    const { searchHistoryService } = createSearchHistoryService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        searchHistoryService={searchHistoryService}
        searchService={searchService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '搜索历史：历史查询' }));

    await waitFor(() => {
      expect(searchService.search).toHaveBeenCalledWith({
        query: '历史查询',
        workspaceId: 'workspace-a'
      });
    });
    await waitFor(() => {
      expect(searchHistoryService.record).toHaveBeenCalledWith({
        query: '历史查询',
        workspaceId: 'workspace-a'
      });
    });
  });

  it('soft deletes a file after confirmation and refreshes the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-delete',
        displayName: '待删除.pdf',
        currentVersion: {
          id: 'version-delete',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          status: 'searchable'
        },
        updatedAt: '2026-08-17T07:00:00.000Z'
      }
    ]);
    const { searchService } = createSearchService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        searchService={searchService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('button', { name: '查看 待删除.pdf' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除选中文件' }));

    await waitFor(() => {
      expect(fileService.softDeleteFile).toHaveBeenCalledWith('file-delete');
    });
    expect(await screen.findByText('拖拽或选择 PDF / DOCX')).toBeInTheDocument();
  });

  it('does not soft delete when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-keep',
        displayName: '保留.pdf',
        currentVersion: {
          id: 'version-keep',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          status: 'searchable'
        },
        updatedAt: '2026-08-17T07:00:00.000Z'
      }
    ]);
    const { searchService } = createSearchService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        searchService={searchService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('button', { name: '查看 保留.pdf' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除选中文件' }));

    expect(fileService.softDeleteFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '查看 保留.pdf' })).toBeInTheDocument();
  });

  it('retries a failed file version and refreshes the list', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-failed',
        displayName: '失败文件.pdf',
        currentVersion: {
          id: 'version-failed',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          status: 'failed'
        },
        updatedAt: '2026-08-17T07:00:00.000Z'
      }
    ]);
    const { searchService } = createSearchService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        searchService={searchService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('button', { name: '查看 失败文件.pdf' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新处理选中文件' }));

    await waitFor(() => {
      expect(fileService.retryFileVersion).toHaveBeenCalledWith('version-failed');
    });
  });

  it('shows a safe error when soft delete fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-delete',
        displayName: '删除失败.pdf',
        currentVersion: {
          id: 'version-delete',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          status: 'searchable'
        },
        updatedAt: '2026-08-17T07:00:00.000Z'
      }
    ]);
    vi.mocked(fileService.softDeleteFile).mockRejectedValueOnce(
      new Error('permission denied')
    );
    const { searchService } = createSearchService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        searchService={searchService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('button', { name: '查看 删除失败.pdf' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除选中文件' }));

    expect(
      await screen.findByText('删除文件失败：permission denied。请稍后重试。')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看 删除失败.pdf' })).toBeInTheDocument();
  });

  it('shows a safe error when retry processing fails', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' }
    ]);
    const { uploadService } = createUploadService();
    const { fileService } = createFileService([
      {
        id: 'file-failed',
        displayName: '重试失败.pdf',
        currentVersion: {
          id: 'version-failed',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          status: 'failed'
        },
        updatedAt: '2026-08-17T07:00:00.000Z'
      }
    ]);
    vi.mocked(fileService.retryFileVersion).mockRejectedValueOnce(
      new Error('worker unavailable')
    );
    const { searchService } = createSearchService();

    render(
      <App
        authService={authService}
        fileService={fileService}
        searchService={searchService}
        uploadService={uploadService}
        workspaceService={workspaceService}
      />
    );

    expect(await screen.findByRole('button', { name: '查看 重试失败.pdf' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新处理选中文件' }));

    expect(
      await screen.findByText('重新处理失败：worker unavailable。请稍后重试。')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看 重试失败.pdf' })).toBeInTheDocument();
  });
});
