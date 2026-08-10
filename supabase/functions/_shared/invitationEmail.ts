export interface InvitationEmail {
  to: string;
  workspaceName: string;
  expiresAt: string;
  acceptUrl: string;
}

export type EnvironmentReader = (name: string) => string | undefined;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendInvitationEmail(
  input: InvitationEmail,
  fetchImpl: typeof fetch = fetch,
  getEnv: EnvironmentReader = (name) => Deno.env.get(name)
): Promise<void> {
  const apiKey = getEnv('RESEND_API_KEY')?.trim();
  const from = getEnv('INVITATION_FROM_EMAIL')?.trim();
  if (!apiKey || !from) {
    throw new Error('Invitation email secrets are not configured');
  }

  const acceptUrl = new URL(input.acceptUrl);
  if (acceptUrl.protocol !== 'https:') {
    throw new Error('Invitation acceptance URL must use HTTPS');
  }

  const workspaceName = input.workspaceName.trim();
  const expiresAt = input.expiresAt.trim();
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `你已被邀请加入 ${workspaceName}`,
      text:
        `请使用此邮箱登录 KnowledgeBase，并在 ${expiresAt} 前打开以下链接接受团队邀请：\n${acceptUrl.toString()}`,
      html:
        `<p>你已被邀请加入 ${escapeHtml(workspaceName)}。</p>` +
        `<p>请使用此邮箱登录 KnowledgeBase，并在 ${escapeHtml(expiresAt)} 前` +
        `<a href="${escapeHtml(acceptUrl.toString())}">接受团队邀请</a>。</p>`
    })
  });

  if (!response.ok) {
    throw new Error(`Invitation email failed: ${response.status}`);
  }
}
