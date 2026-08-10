import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isApprovedTestProject } from './approvedTestProjects';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface CloudTestEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  projectRef: string;
}

function required(
  values: Record<string, string | undefined>,
  name: string
): string {
  const value = values[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadCloudTestEnv(
  values?: Record<string, string | undefined>
): CloudTestEnv {
  if (!values) {
    loadEnv({ path: path.join(repoRoot, '.env.local') });
  }
  const environment = values ?? process.env;
  if (required(environment, 'SUPABASE_ENVIRONMENT') !== 'development') {
    throw new Error('Cloud tests require SUPABASE_ENVIRONMENT=development');
  }
  const projectRef = required(environment, 'SUPABASE_TEST_PROJECT_REF');
  const url = required(environment, 'SUPABASE_URL');
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must use https');
  }
  if (parsedUrl.hostname !== `${projectRef}.supabase.co`) {
    throw new Error('SUPABASE_URL does not match SUPABASE_TEST_PROJECT_REF');
  }
  if (!isApprovedTestProject(projectRef)) {
    throw new Error(
      'SUPABASE_TEST_PROJECT_REF is not approved for cloud tests'
    );
  }
  return {
    url,
    projectRef,
    anonKey: required(environment, 'SUPABASE_ANON_KEY'),
    serviceRoleKey: required(environment, 'SUPABASE_SERVICE_ROLE_KEY')
  };
}
