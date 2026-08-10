import { sendInvitationEmail } from '../_shared/invitationEmail.ts';
import { createHandler, type HandlerDependencies } from './index.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    `Expected ${expectedJson}, received ${actualJson}`
  );
}

const emailInput = {
  to: 'invitee@example.com',
  workspaceName: '<研发 & 产品>',
  expiresAt: '2026-08-14T00:00:00.000Z',
  acceptUrl: 'https://app.example.com/invitations/accept?token=one&next=two'
};

const emailEnvironment: Readonly<Record<string, string>> = {
  RESEND_API_KEY: 'unit-test-key',
  INVITATION_FROM_EMAIL: 'KnowledgeBase <noreply@example.com>'
};

const testEnv = (name: string) => emailEnvironment[name];

Deno.test('sendInvitationEmail sends escaped text and HTML through Resend', async () => {
  let request: Request | undefined;
  const fakeFetch: typeof fetch = (input, init) => {
    request = new Request(input, init);
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  await sendInvitationEmail(emailInput, fakeFetch, testEnv);

  assert(request, 'Expected one Resend request');
  assertEquals(request.url, 'https://api.resend.com/emails');
  assertEquals(request.method, 'POST');
  assertEquals(
    request.headers.get('authorization'),
    'Bearer unit-test-key'
  );
  const body = JSON.parse(await request.text());
  assertEquals(body.to, ['invitee@example.com']);
  assert(body.text.includes(emailInput.acceptUrl), 'Text must include the URL');
  assert(
    body.html.includes('&lt;研发 &amp; 产品&gt;'),
    'Workspace name must be HTML escaped'
  );
  assert(
    body.html.includes('token=one&amp;next=two'),
    'Invitation URL must be HTML escaped'
  );
});

Deno.test('sendInvitationEmail reports only the failed response status', async () => {
  const fakeFetch: typeof fetch = () =>
    Promise.resolve(
      new Response('provider body must not enter the error', { status: 500 })
    );

  let message = '';
  try {
    await sendInvitationEmail(emailInput, fakeFetch, testEnv);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(message, 'Invitation email failed: 500');
  assert(!message.includes(emailInput.to), 'Error must not contain recipient');
  assert(!message.includes('unit-test-key'), 'Error must not contain API key');
  assert(
    !message.includes('provider body'),
    'Error must not contain provider response body'
  );
});

function createRequest(
  body: unknown,
  method = 'POST',
  authorization = 'Bearer user-jwt'
): Request {
  return new Request('https://project.supabase.co/functions/v1/send', {
    method,
    headers: {
      authorization,
      'content-type': 'application/json'
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });
}

function createDependencies(overrides: Partial<HandlerDependencies> = {}) {
  const sent: Array<Record<string, string>> = [];
  const handlerEnvironment: Readonly<Record<string, string>> = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    INVITATION_ACCEPT_BASE_URL: 'https://app.example.com/base'
  };
  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: 'user-id' } }, error: null })
    },
    rpc: () =>
      Promise.resolve({
        data: [
          {
            invitation_id: '11111111-1111-4111-8111-111111111111',
            invitation_token: '22222222-2222-4222-8222-222222222222',
            expires_at: '2026-08-14T00:00:00.000Z'
          }
        ],
        error: null
      }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: { name: 'Team' }, error: null })
        })
      })
    })
  };
  const dependencies: HandlerDependencies = {
    createSupabaseClient: () => client,
    sendEmail: (input) => {
      sent.push(input as unknown as Record<string, string>);
      return Promise.resolve();
    },
    getEnv: (name) => handlerEnvironment[name],
    ...overrides
  };
  return { dependencies, sent };
}

Deno.test('handler supports CORS preflight and rejects other non-POST methods', async () => {
  const { dependencies } = createDependencies();
  const handler = createHandler(dependencies);

  const optionsResponse = await handler(createRequest({}, 'OPTIONS'));
  assertEquals(optionsResponse.status, 204);
  assertEquals(
    optionsResponse.headers.get('access-control-allow-origin'),
    '*'
  );

  const getResponse = await handler(createRequest({}, 'GET'));
  assertEquals(getResponse.status, 405);
  assertEquals(getResponse.headers.get('allow'), 'POST, OPTIONS');
});

Deno.test('handler verifies authentication before creating an invitation', async () => {
  let rpcCalled = false;
  const { dependencies } = createDependencies({
    createSupabaseClient: () => ({
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: null }, error: new Error('bad jwt') })
      },
      rpc: () => {
        rpcCalled = true;
        return Promise.resolve({ data: null, error: null });
      },
      from: () => {
        throw new Error('unreachable');
      }
    })
  });

  const response = await createHandler(dependencies)(
    createRequest({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      email: 'invitee@example.com'
    })
  );

  assertEquals(response.status, 401);
  assertEquals(rpcCalled, false);
});

Deno.test('handler sends a safe token URL and returns only the invitation ID', async () => {
  const { dependencies, sent } = createDependencies();
  const response = await createHandler(dependencies)(
    createRequest({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      email: ' INVITEE@EXAMPLE.COM '
    })
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    invitationId: '11111111-1111-4111-8111-111111111111'
  });
  assertEquals(sent, [
    {
      to: 'invitee@example.com',
      workspaceName: 'Team',
      expiresAt: '2026-08-14T00:00:00.000Z',
      acceptUrl:
        'https://app.example.com/invitations/accept?token=22222222-2222-4222-8222-222222222222'
    }
  ]);
});

Deno.test('handler returns 502 without exposing email delivery details', async () => {
  const { dependencies } = createDependencies({
    sendEmail: () => Promise.reject(new Error('secret provider response'))
  });
  const response = await createHandler(dependencies)(
    createRequest({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      email: 'invitee@example.com'
    })
  );

  assertEquals(response.status, 502);
  const body = await response.text();
  assertEquals(body, JSON.stringify({ error: 'Invitation email delivery failed' }));
  assert(!body.includes('secret provider response'), 'Must hide provider error');
  assert(!body.includes('invitee@example.com'), 'Must hide recipient');
});
