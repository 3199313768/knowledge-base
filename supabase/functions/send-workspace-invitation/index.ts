import { createClient } from 'npm:@supabase/supabase-js@2.112.0';
import {
  sendInvitationEmail,
  type InvitationEmail
} from '../_shared/invitationEmail.ts';

interface QueryResult<T> {
  data: T;
  error: unknown;
}

interface InvitationSupabaseClient {
  auth: {
    getUser(): Promise<QueryResult<{ user: { id: string } | null }>>;
  };
  rpc(
    name: string,
    parameters: Record<string, string>
  ): Promise<QueryResult<unknown>>;
  from(name: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): Promise<QueryResult<{ name: string } | null>>;
      };
    };
  };
}

export interface HandlerDependencies {
  createSupabaseClient(
    url: string,
    anonKey: string,
    options: Record<string, unknown>
  ): InvitationSupabaseClient;
  sendEmail(input: InvitationEmail): Promise<void>;
  getEnv(name: string): string | undefined;
}

interface CreatedInvitation {
  invitation_id: string;
  invitation_token: string;
  expires_at: string;
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400'
};

const defaultDependencies: HandlerDependencies = {
  createSupabaseClient: (url, anonKey, options) =>
    createClient(url, anonKey, options) as unknown as InvitationSupabaseClient,
  sendEmail: sendInvitationEmail,
  getEnv: (name) => Deno.env.get(name)
};

function jsonResponse(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function requiredEnvironment(
  dependencies: HandlerDependencies,
  name: string
): string {
  const value = dependencies.getEnv(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return '';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parseCreatedInvitation(data: unknown): CreatedInvitation | null {
  const value = Array.isArray(data) ? data[0] : data;
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.invitation_id !== 'string' ||
    typeof record.invitation_token !== 'string' ||
    typeof record.expires_at !== 'string'
  ) {
    return null;
  }
  return {
    invitation_id: record.invitation_id,
    invitation_token: record.invitation_token,
    expires_at: record.expires_at
  };
}

function buildAcceptanceUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Invitation acceptance URL is invalid');
  }
  url.pathname = '/invitations/accept';
  url.search = '';
  url.hash = '';
  url.searchParams.set('token', token);
  return url.toString();
}

export function createHandler(
  dependencies: HandlerDependencies = defaultDependencies
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: {
          ...corsHeaders,
          allow: 'POST, OPTIONS',
          'content-type': 'application/json; charset=utf-8'
        }
      });
    }

    const authorization = request.headers.get('authorization')?.trim();
    if (!authorization?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Authentication required' }, 401);
    }

    let client: InvitationSupabaseClient;
    let acceptBaseUrl: string;
    try {
      const supabaseUrl = requiredEnvironment(dependencies, 'SUPABASE_URL');
      const anonKey = requiredEnvironment(dependencies, 'SUPABASE_ANON_KEY');
      acceptBaseUrl = requiredEnvironment(
        dependencies,
        'INVITATION_ACCEPT_BASE_URL'
      );
      client = dependencies.createSupabaseClient(supabaseUrl, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        },
        global: { headers: { Authorization: authorization } }
      });
    } catch {
      return jsonResponse({ error: 'Invitation service is unavailable' }, 500);
    }

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse({ error: 'Authentication required' }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return jsonResponse({ error: 'Invalid request body' }, 400);
    }
    const { workspaceId, email } = body as Record<string, unknown>;
    if (
      typeof workspaceId !== 'string' ||
      !isUuid(workspaceId) ||
      typeof email !== 'string' ||
      email.trim() === ''
    ) {
      return jsonResponse({ error: 'Invalid request body' }, 400);
    }
    const normalizedEmail = email.trim().toLowerCase();

    const { data: invitationData, error: invitationError } = await client.rpc(
      'create_workspace_invitation',
      { p_workspace_id: workspaceId, p_email: normalizedEmail }
    );
    if (invitationError) {
      const status = errorMessage(invitationError).includes(
        'workspace admin required'
      )
        ? 403
        : 400;
      return jsonResponse({ error: 'Unable to create invitation' }, status);
    }
    const invitation = parseCreatedInvitation(invitationData);
    if (!invitation) {
      return jsonResponse({ error: 'Invitation service is unavailable' }, 500);
    }

    const { data: workspace, error: workspaceError } = await client
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .single();
    if (workspaceError || !workspace) {
      return jsonResponse({ error: 'Invitation service is unavailable' }, 500);
    }

    let acceptUrl: string;
    try {
      acceptUrl = buildAcceptanceUrl(
        acceptBaseUrl,
        invitation.invitation_token
      );
    } catch {
      return jsonResponse({ error: 'Invitation service is unavailable' }, 500);
    }

    try {
      await dependencies.sendEmail({
        to: normalizedEmail,
        workspaceName: workspace.name,
        expiresAt: invitation.expires_at,
        acceptUrl
      });
    } catch {
      return jsonResponse({ error: 'Invitation email delivery failed' }, 502);
    }

    return jsonResponse({ invitationId: invitation.invitation_id }, 200);
  };
}

if (import.meta.main) {
  Deno.serve(createHandler());
}
