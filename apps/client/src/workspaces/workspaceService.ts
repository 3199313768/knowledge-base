import { getSupabaseBrowserClient } from '../lib/supabaseClient';

export interface WorkspaceSummary {
  createdAt: string | null;
  id: string;
  name: string;
}

export interface WorkspaceService {
  createWorkspace: (name: string) => Promise<string>;
  listWorkspaces: () => Promise<WorkspaceSummary[]>;
}

interface WorkspaceRow {
  created_at: string | null;
  id: string;
  name: string;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '团队操作失败';
}

export const defaultWorkspaceService: WorkspaceService = {
  async listWorkspaces() {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from('workspaces')
      .select('id,name,created_at')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(messageFrom(error));
    }

    return ((data ?? []) as WorkspaceRow[]).map((workspace) => ({
      createdAt: workspace.created_at,
      id: workspace.id,
      name: workspace.name
    }));
  },

  async createWorkspace(name) {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc('create_workspace', {
      p_name: name
    });

    if (error) {
      throw new Error(messageFrom(error));
    }

    if (typeof data !== 'string') {
      throw new Error('创建团队失败：服务端没有返回团队 ID');
    }

    return data;
  }
};
