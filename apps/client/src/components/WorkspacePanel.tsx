import { Field, Label, StatusMessage } from '@oxygen-design/ui';
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreateWorkspace(workspaceName);
    setWorkspaceName('');
    setIsCreateOpen(false);
  }

  if (isLoading) {
    return (
      <section className="workspace-panel">
        <StatusMessage>正在读取团队…</StatusMessage>
      </section>
    );
  }

  const showCreateForm = workspaces.length === 0 || isCreateOpen;

  return (
    <section className="workspace-panel" aria-labelledby="workspace-title">
      <div className="workspace-panel__header">
        <h2 id="workspace-title">
          {currentWorkspace ? '选择当前团队' : '创建你的第一个团队'}
        </h2>
        {workspaces.length > 0 && !isCreateOpen ? (
          <Button onClick={() => setIsCreateOpen(true)} variant="ghost">
            新建团队
          </Button>
        ) : null}
      </div>

      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

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

      {showCreateForm ? (
        <form className="workspace-create" onSubmit={handleCreateWorkspace}>
          <Field className="field">
            <Label htmlFor="workspace-name">团队名称</Label>
            <TextInput
              id="workspace-name"
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="例如：产品知识库"
              type="text"
              value={workspaceName}
            />
          </Field>
          <div className="workspace-create__actions">
            {workspaces.length > 0 ? (
              <Button
                onClick={() => {
                  setIsCreateOpen(false);
                  setWorkspaceName('');
                }}
                type="button"
                variant="ghost"
              >
                取消
              </Button>
            ) : null}
            <Button disabled={isCreating} type="submit" variant="primary">
              创建团队
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
