import { PageHeader } from '@oxygen-design/ui';
import { WorkspacePanel } from './WorkspacePanel';
import { Card } from './ui/Card';
import type { WorkspaceSummary } from '../workspaces/workspaceService';

interface TeamsPageProps {
  currentWorkspace: WorkspaceSummary | null;
  error: string | null;
  isCreating: boolean;
  isLoading: boolean;
  onCreateWorkspace: (name: string) => Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void;
  workspaces: WorkspaceSummary[];
}

export function TeamsPage({
  currentWorkspace,
  error,
  isCreating,
  isLoading,
  onCreateWorkspace,
  onSelectWorkspace,
  workspaces
}: TeamsPageProps) {
  return (
    <section className="content-pane" aria-label="团队小组">
      <PageHeader title="团队小组" />
      <Card className="section-card">
        <WorkspacePanel
          currentWorkspace={currentWorkspace}
          error={error}
          isCreating={isCreating}
          isLoading={isLoading}
          onCreateWorkspace={onCreateWorkspace}
          onSelectWorkspace={onSelectWorkspace}
          workspaces={workspaces}
        />
      </Card>
    </section>
  );
}
