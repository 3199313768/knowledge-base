import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { AuthService } from './auth/authService';
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
    expect(await screen.findByText('当前团队：产品知识库')).toBeInTheDocument();
  });

  it('selects an existing workspace from the workspace list', async () => {
    const { authService } = createAuthService(sessionFor('owner@example.test'));
    const { workspaceService } = createWorkspaceService([
      { id: 'workspace-a', name: '研发团队', createdAt: '2026-08-17T00:00:00.000Z' },
      { id: 'workspace-b', name: '运营团队', createdAt: '2026-08-16T00:00:00.000Z' }
    ]);

    render(<App authService={authService} workspaceService={workspaceService} />);

    expect(await screen.findByText('当前团队：研发团队')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '运营团队' }));

    expect(await screen.findByText('当前团队：运营团队')).toBeInTheDocument();
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
});
