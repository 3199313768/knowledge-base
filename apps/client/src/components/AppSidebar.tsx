import { WorkspacePanel } from './WorkspacePanel';
import { Button } from './ui/Button';
import type { WorkspaceSummary } from '../workspaces/workspaceService';

interface AppSidebarProps {
  currentWorkspace: WorkspaceSummary | null;
  email: string;
  error: string | null;
  isCreatingWorkspace: boolean;
  isLoadingWorkspaces: boolean;
  onCreateWorkspace: (name: string) => Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void;
  onSignOutCurrentDevice: () => Promise<void>;
  workspaces: WorkspaceSummary[];
}

const navigationItems = [
  { label: '资料', meta: '当前页面', active: true },
  { label: '搜索', meta: '已可使用', active: false },
  { label: '上传', meta: '已可使用', active: false },
  { label: '设置', meta: '即将接入', active: false }
];

export function AppSidebar({
  currentWorkspace,
  email,
  error,
  isCreatingWorkspace,
  isLoadingWorkspaces,
  onCreateWorkspace,
  onSelectWorkspace,
  onSignOutCurrentDevice,
  workspaces
}: AppSidebarProps) {
  return (
    <aside className="sidebar" aria-label="应用侧边栏">
      <div className="sidebar__brand">
        <div className="app-icon" aria-hidden="true">
          K
        </div>
        <div>
          <p className="eyebrow">Knowledge Base</p>
          <h1>知识库</h1>
          <p>Mac + iPhone 私有资料工作台</p>
        </div>
      </div>

      <nav className="app-nav" aria-label="应用导航">
        {navigationItems.map((item) => (
          <Button
            aria-current={item.active ? 'page' : undefined}
            aria-label={`${item.label} ${item.meta}`}
            className={item.active ? 'nav-item nav-item--active' : 'nav-item'}
            key={item.label}
            variant="nav"
          >
            <span>{item.label}</span>
            <span>{item.meta}</span>
          </Button>
        ))}
      </nav>

      <WorkspacePanel
        currentWorkspace={currentWorkspace}
        error={error}
        isCreating={isCreatingWorkspace}
        isLoading={isLoadingWorkspaces}
        onCreateWorkspace={onCreateWorkspace}
        onSelectWorkspace={onSelectWorkspace}
        workspaces={workspaces}
      />

      <div className="account-card account-card--footer">
        <span className="account-card__label">当前账号</span>
        <span className="account-card__email">{email}</span>
        <Button onClick={onSignOutCurrentDevice} variant="ghost">
          退出当前设备
        </Button>
      </div>
    </aside>
  );
}
