import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceService, WorkspaceSummary } from './workspaceService';

interface WorkspaceState {
  createWorkspace: (name: string) => Promise<void>;
  currentWorkspace: WorkspaceSummary | null;
  error: string | null;
  isCreating: boolean;
  isLoading: boolean;
  selectWorkspace: (workspaceId: string) => void;
  workspaces: WorkspaceSummary[];
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : '团队操作失败';
}

export function useWorkspaces(workspaceService: WorkspaceService): WorkspaceState {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspaces = useCallback(
    async (preferredWorkspaceId?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const nextWorkspaces = await workspaceService.listWorkspaces();
        setWorkspaces(nextWorkspaces);

        if (preferredWorkspaceId && nextWorkspaces.some((item) => item.id === preferredWorkspaceId)) {
          setCurrentWorkspaceId(preferredWorkspaceId);
        } else {
          setCurrentWorkspaceId((previousId) => {
            if (previousId && nextWorkspaces.some((item) => item.id === previousId)) {
              return previousId;
            }

            return nextWorkspaces[0]?.id ?? null;
          });
        }
      } catch (caughtError) {
        setError(`读取团队失败：${safeMessage(caughtError)}`);
        setWorkspaces([]);
        setCurrentWorkspaceId(null);
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceService]
  );

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  async function createWorkspace(name: string) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError('请输入团队名称');
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const workspaceId = await workspaceService.createWorkspace(normalizedName);
      await loadWorkspaces(workspaceId);
    } catch (caughtError) {
      setError(`创建团队失败：${safeMessage(caughtError)}`);
    } finally {
      setIsCreating(false);
    }
  }

  function selectWorkspace(workspaceId: string) {
    setCurrentWorkspaceId(workspaceId);
  }

  return {
    createWorkspace,
    currentWorkspace:
      workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    error,
    isCreating,
    isLoading,
    selectWorkspace,
    workspaces
  };
}
