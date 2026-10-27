import { Clock3, Files, Settings, Trash2, Users } from '@oxygen-design/ui';
import { Button } from './ui/Button';
import type { WorkspaceSummary } from '../workspaces/workspaceService';

export type SidebarSection = 'files' | 'recent' | 'recycle' | 'teams' | 'settings';

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
  icon: 'files' | 'recent' | 'recycle' | 'teams' | 'settings';
}> = [
  { id: 'files', label: '所有文件', icon: 'files' },
  { id: 'recent', label: '最近使用', icon: 'recent' },
  { id: 'recycle', label: '回收站', icon: 'recycle' },
  { id: 'teams', label: '团队小组', icon: 'teams' },
  { id: 'settings', label: '设置', icon: 'settings' }
];

function NavIcon({ name }: { name: 'files' | 'recent' | 'recycle' | 'teams' | 'settings' }) {
  const Icon = {
    files: Files,
    recent: Clock3,
    recycle: Trash2,
    teams: Users,
    settings: Settings,
  }[name];

  return <Icon aria-hidden="true" className="nav-item__icon" />;
}

interface SidebarNavigationProps {
  activeSection: SidebarSection;
  onNavigate: (section: SidebarSection) => void;
}

export function SidebarNavigation({ activeSection, onNavigate }: SidebarNavigationProps) {
  return (
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

      <SidebarNavigation activeSection={activeSection} onNavigate={onNavigate} />

      <div className="account-card account-card--footer">
        <span className="account-card__email">{email}</span>
        <Button onClick={onSignOutCurrentDevice} variant="ghost">
          退出当前设备
        </Button>
      </div>
    </aside>
  );
}
