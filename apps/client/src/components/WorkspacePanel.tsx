import { FormEvent, useState } from 'react';
import { Button } from './ui/Button';
import { TextInput } from './ui/TextInput';
import type { WorkspaceSummary } from '../workspaces/workspaceService';

interface WorkspacePanelProps {
  currentWorkspace: WorkspaceSummary | null;
  error: string | null;
  isCreating: boolean;
  isLoading: boolean;
  onCreateWorkspace: (name: string) => Promise<void>;
  onSelectWorkspace: (workspaceId: string) => void;
  workspaces: WorkspaceSummary[];
}

export function WorkspacePanel({
  currentWorkspace,
  error,
  isCreating,
  isLoading,
  onCreateWorkspace,
  onSelectWorkspace,
  workspaces
}: WorkspacePanelProps) {
  const [workspaceName, setWorkspaceName] = useState('');

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreateWorkspace(workspaceName);
    setWorkspaceName('');
  }

  if (isLoading) {
    return (
      <section className="workspace-panel">
        <p>正在读取团队…</p>
      </section>
    );
  }

  return (
    <section className="workspace-panel" aria-labelledby="workspace-title">
      <div className="workspace-panel__header">
        <div>
          <p className="eyebrow">Teams</p>
          <h2 id="workspace-title">
            {currentWorkspace ? '选择当前团队' : '创建你的第一个团队'}
          </h2>
        </div>
      </div>

      {error ? <p className="message message--error">{error}</p> : null}

      {workspaces.length > 0 ? (
        <div className="workspace-list" aria-label="团队列表">
          {workspaces.map((workspace) => (
            <Button
              className={
                workspace.id === currentWorkspace?.id
                  ? 'workspace-item workspace-item--active'
                  : 'workspace-item'
              }
              key={workspace.id}
              onClick={() => onSelectWorkspace(workspace.id)}
              variant="nav"
            >
              {workspace.name}
            </Button>
          ))}
        </div>
      ) : (
        <p className="auth-card__description">
          还没有团队。先创建一个团队，后续上传、搜索和权限都将归属到当前团队。
        </p>
      )}

      <form className="workspace-create" onSubmit={handleCreateWorkspace}>
        <label className="field">
          <span>团队名称</span>
          <TextInput
            onChange={(event) => setWorkspaceName(event.target.value)}
            placeholder="例如：产品知识库"
            type="text"
            value={workspaceName}
          />
        </label>
        <Button disabled={isCreating} type="submit" variant="primary">
          创建团队
        </Button>
      </form>
    </section>
  );
}
