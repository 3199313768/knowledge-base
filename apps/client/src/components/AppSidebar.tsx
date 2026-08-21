import { Button } from './ui/Button';
import type { WorkspaceSummary } from '../workspaces/workspaceService';

export type SidebarSection = 'files' | 'recent' | 'teams' | 'settings';

interface AppSidebarProps {
  activeSection: SidebarSection;
  currentWorkspace: WorkspaceSummary | null;
  email: string;
  onNavigate: (section: SidebarSection) => void;
  onSignOutCurrentDevice: () => Promise<void>;
}

const navigationItems: Array<{
  id: SidebarSection;
  label: string;
  icon: 'files' | 'recent' | 'teams' | 'settings';
}> = [
  { id: 'files', label: '所有文件', icon: 'files' },
  { id: 'recent', label: '最近使用', icon: 'recent' },
  { id: 'teams', label: '团队小组', icon: 'teams' },
  { id: 'settings', label: '设置', icon: 'settings' }
];

function NavIcon({ name }: { name: 'files' | 'recent' | 'teams' | 'settings' }) {
  if (name === 'files') {
    return (
      <svg aria-hidden="true" className="nav-item__icon" fill="none" viewBox="0 0 16 16">
        <path
          d="M2.5 4.5h4l1.2 1.2H13.5v7.3a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
      </svg>
    );
  }

  if (name === 'recent') {
    return (
      <svg aria-hidden="true" className="nav-item__icon" fill="none" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 5v3.2L10 10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      </svg>
    );
  }

  if (name === 'teams') {
    return (
      <svg aria-hidden="true" className="nav-item__icon" fill="none" viewBox="0 0 16 16">
        <circle cx="8" cy="5.2" r="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="4.2" cy="6.2" r="1.5" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="11.8" cy="6.2" r="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M3 12.5c.4-1.8 1.9-2.8 5-2.8s4.6 1 5 2.8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="nav-item__icon" fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 2.4v1.4M8 12.2v1.4M2.4 8h1.4M12.2 8h1.4M3.9 3.9l1 1M11.1 11.1l1 1M12.1 3.9l-1 1M4.9 11.1l-1 1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function AppSidebar({
  activeSection,
  currentWorkspace,
  email,
  onNavigate,
  onSignOutCurrentDevice
}: AppSidebarProps) {
  return (
    <aside className="sidebar" aria-label="应用侧边栏">
      <div className="sidebar__brand">
        <div className="app-icon" aria-hidden="true">
          K
        </div>
        <h1>知识库</h1>
        {currentWorkspace ? (
          <button
            aria-label={`当前团队 ${currentWorkspace.name}`}
            className="sidebar__team-badge"
            onClick={() => onNavigate('teams')}
            type="button"
          >
            {currentWorkspace.name}
          </button>
        ) : null}
      </div>

      <nav className="app-nav" aria-label="应用导航">
        {navigationItems.map((item) => {
          const isActive = activeSection === item.id;

          return (
            <Button
              aria-current={isActive ? 'page' : undefined}
              className={isActive ? 'nav-item nav-item--active' : 'nav-item'}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              variant="nav"
            >
              <span className="nav-item__label">
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </span>
            </Button>
          );
        })}
      </nav>

      <div className="account-card account-card--footer">
        <span className="account-card__email">{email}</span>
        <Button onClick={onSignOutCurrentDevice} variant="ghost">
          退出当前设备
        </Button>
      </div>
    </aside>
  );
}
