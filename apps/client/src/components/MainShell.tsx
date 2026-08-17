import { WorkspacePanel } from './WorkspacePanel';
import { useWorkspaces } from '../workspaces/useWorkspaces';
import type { WorkspaceService } from '../workspaces/workspaceService';

interface MainShellProps {
  email: string;
  onSignOutCurrentDevice: () => Promise<void>;
  workspaceService: WorkspaceService;
}

export function MainShell({
  email,
  onSignOutCurrentDevice,
  workspaceService
}: MainShellProps) {
  const workspaceState = useWorkspaces(workspaceService);

  return (
    <main className="shell">
      <div className="app-frame">
        <aside className="sidebar" aria-label="应用侧边栏">
          <div className="sidebar__brand">
            <div className="app-icon" aria-hidden="true">
              K
            </div>
            <div>
              <p className="eyebrow">Knowledge Base</p>
              <h1>知识库</h1>
            </div>
          </div>

          <div className="account-card">
            <span className="account-card__label">当前账号</span>
            <span className="account-card__email">{email}</span>
          </div>

          <WorkspacePanel
            currentWorkspace={workspaceState.currentWorkspace}
            error={workspaceState.error}
            isCreating={workspaceState.isCreating}
            isLoading={workspaceState.isLoading}
            onCreateWorkspace={workspaceState.createWorkspace}
            onSelectWorkspace={workspaceState.selectWorkspace}
            workspaces={workspaceState.workspaces}
          />

          <button
            className="button button--ghost"
            onClick={onSignOutCurrentDevice}
            type="button"
          >
            退出当前设备
          </button>
        </aside>

        <section className="content-pane">
          <header className="content-header">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>
                {workspaceState.currentWorkspace
                  ? workspaceState.currentWorkspace.name
                  : '请选择团队'}
              </h2>
            </div>
            {workspaceState.currentWorkspace ? (
              <p className="workspace-current">
                当前团队：{workspaceState.currentWorkspace.name}
              </p>
            ) : null}
          </header>

          <section className="empty-state">
            <div className="empty-state__icon" aria-hidden="true">
              ↑
            </div>
            <h2>
              {workspaceState.currentWorkspace
                ? '已选择团队，可以继续接入上传资料'
                : '请先创建或选择团队'}
            </h2>
            <p>上传、搜索和同步能力将在后续 Phase 3 子任务中接入。</p>
          </section>
        </section>
      </div>
    </main>
  );
}
