import { expect, it, vi } from 'vitest';

const { loadEnv } = vi.hoisted(() => ({ loadEnv: vi.fn() }));

vi.mock('dotenv', () => ({ config: loadEnv }));

import { loadCloudTestEnv } from './env';

const approvedTestEnvironment = {
  SUPABASE_ENVIRONMENT: 'development',
  SUPABASE_TEST_PROJECT_REF: 'dedicated-test-project',
  SUPABASE_URL: 'https://dedicated-test-project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
};

it('fails closed for an unapproved test project ref without loading .env.local', () => {
  expect(() => loadCloudTestEnv(approvedTestEnvironment)).toThrow(
    'SUPABASE_TEST_PROJECT_REF is not approved for cloud tests'
  );
  expect(loadEnv).not.toHaveBeenCalled();
});

it('rejects a URL that is not HTTPS', () => {
  expect(() =>
    loadCloudTestEnv({
      ...approvedTestEnvironment,
      SUPABASE_URL: 'http://dedicated-test-project.supabase.co'
    })
  ).toThrow('SUPABASE_URL must use https');
});

it('fails closed when the dedicated test project ref is absent', () => {
  const { SUPABASE_TEST_PROJECT_REF: _, ...withoutTestRef } =
    approvedTestEnvironment;

  expect(() => loadCloudTestEnv(withoutTestRef)).toThrow(
    'Missing required environment variable: SUPABASE_TEST_PROJECT_REF'
  );
});
