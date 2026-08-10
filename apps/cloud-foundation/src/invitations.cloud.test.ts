import { describe, expect, it } from 'vitest';
import {
  createWorkspace,
  runWithCloudHarness,
  type CloudHarness,
  type TestActor
} from './testHarness';

interface CreatedInvitation {
  invitation_id: string;
  invitation_token: string;
  expires_at: string;
}

describe('workspace invitations', () => {
  async function createInvitation(
    harness: CloudHarness,
    owner: TestActor,
    workspaceId: string,
    email: string
  ): Promise<CreatedInvitation> {
    const { data, error } = await owner.client.rpc(
      'create_workspace_invitation',
      { p_workspace_id: workspaceId, p_email: email }
    );
    expect(error).toBeNull();
    const invitation = Array.isArray(data) ? data[0] : data;
    expect(invitation).toEqual(
      expect.objectContaining({
        invitation_id: expect.any(String),
        invitation_token: expect.any(String),
        expires_at: expect.any(String)
      })
    );
    const createdInvitation = invitation as CreatedInvitation;
    harness.trackInvitation(createdInvitation.invitation_id);
    const { data: storedInvitation, error: storedInvitationError } =
      await owner.client
        .from('workspace_invitations')
        .select('created_at, expires_at')
        .eq('id', createdInvitation.invitation_id)
        .single();
    expect(storedInvitationError).toBeNull();
    expect(
      Date.parse(storedInvitation?.expires_at ?? '') -
        Date.parse(storedInvitation?.created_at ?? '')
    ).toBe(7 * 24 * 60 * 60 * 1000);
    return createdInvitation;
  }

  async function membershipCount(
    actor: TestActor,
    workspaceId: string
  ): Promise<number> {
    const { count, error } = await actor.client
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('user_id', actor.userId);
    expect(error).toBeNull();
    return count ?? 0;
  }

  it('accepts only for the authenticated invited email', () =>
    runWithCloudHarness(async (harness) => {
    const owner = await harness.createActor('owner');
    const invitee = await harness.createActor('invitee');
    const wrongUser = await harness.createActor('wrong');
    const workspaceId = await createWorkspace(owner.client, harness);
    const invitation = await createInvitation(
      harness,
      owner,
      workspaceId,
      invitee.email.toUpperCase()
    );

    const { data: wrongRows, error: wrongListError } = await wrongUser.client
      .from('workspace_invitations')
      .select('id')
      .eq('id', invitation.invitation_id);
    expect(wrongListError).toBeNull();
    expect(wrongRows).toEqual([]);

    const { error: wrongError } = await wrongUser.client.rpc(
      'accept_workspace_invitation',
      { p_invitation_token: invitation.invitation_token }
    );
    expect(wrongError?.message).toContain('invitation email does not match');

    const { data: workspaceResult, error: acceptError } =
      await invitee.client.rpc('accept_workspace_invitation', {
        p_invitation_token: invitation.invitation_token
      });
    expect(acceptError).toBeNull();
    expect(workspaceResult).toBe(workspaceId);

    const { data: membership } = await invitee.client
      .from('memberships')
      .select('role')
      .eq('workspace_id', workspaceId)
      .single();
    expect(membership?.role).toBe('member');
    }));

  it('allows only an administrator to create or revoke an invitation', () =>
    runWithCloudHarness(async (harness) => {
    const owner = await harness.createActor('owner');
    const member = await harness.createActor('member');
    const invitee = await harness.createActor('invitee');
    const workspaceId = await createWorkspace(owner.client, harness);
    const { error: fixtureError } = await harness.admin
      .from('memberships')
      .insert({ workspace_id: workspaceId, user_id: member.userId });
    if (fixtureError) throw fixtureError;

    const { error: memberCreateError } = await member.client.rpc(
      'create_workspace_invitation',
      { p_workspace_id: workspaceId, p_email: invitee.email }
    );
    expect(memberCreateError?.message).toContain('workspace admin required');

    const invitation = await createInvitation(
      harness,
      owner,
      workspaceId,
      invitee.email
    );
    const { error: memberRevokeError } = await member.client.rpc(
      'revoke_workspace_invitation',
      { p_invitation_id: invitation.invitation_id }
    );
    expect(memberRevokeError?.message).toContain('workspace admin required');

    const { error: revokeError } = await owner.client.rpc(
      'revoke_workspace_invitation',
      { p_invitation_id: invitation.invitation_id }
    );
    expect(revokeError).toBeNull();

    const { error: acceptError } = await invitee.client.rpc(
      'accept_workspace_invitation',
      { p_invitation_token: invitation.invitation_token }
    );
    expect(acceptError?.message).toContain('invitation has been revoked');
    }));

  it('hides and rejects an expired invitation', () =>
    runWithCloudHarness(async (harness) => {
    const owner = await harness.createActor('owner');
    const invitee = await harness.createActor('invitee');
    const workspaceId = await createWorkspace(owner.client, harness);
    const invitation = await createInvitation(
      harness,
      owner,
      workspaceId,
      invitee.email
    );
    const { error: fixtureError } = await harness.admin
      .from('workspace_invitations')
      .update({ expires_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', invitation.invitation_id);
    if (fixtureError) throw fixtureError;

    const { data: pending, error: listError } = await invitee.client.rpc(
      'list_my_pending_invitations'
    );
    expect(listError).toBeNull();
    expect(pending).toEqual([]);

    const { error: acceptError } = await invitee.client.rpc(
      'accept_workspace_invitation',
      { p_invitation_token: invitation.invitation_token }
    );
    expect(acceptError?.message).toContain('invitation has expired');
    expect(await membershipCount(invitee, workspaceId)).toBe(0);
    }));

  it('invalidates the old token when an invitation is resent', () =>
    runWithCloudHarness(async (harness) => {
    const owner = await harness.createActor('owner');
    const invitee = await harness.createActor('invitee');
    const workspaceId = await createWorkspace(owner.client, harness);
    const oldInvitation = await createInvitation(
      harness,
      owner,
      workspaceId,
      invitee.email
    );
    const newInvitation = await createInvitation(
      harness,
      owner,
      workspaceId,
      invitee.email.toUpperCase()
    );

    expect(newInvitation.invitation_id).not.toBe(oldInvitation.invitation_id);
    expect(newInvitation.invitation_token).not.toBe(
      oldInvitation.invitation_token
    );

    const { data: oldRows, error: oldRowError } = await owner.client
      .from('workspace_invitations')
      .select('status, revoked_at')
      .eq('id', oldInvitation.invitation_id);
    expect(oldRowError).toBeNull();
    expect(oldRows).toEqual([
      { status: 'revoked', revoked_at: expect.any(String) }
    ]);

    const { error: oldAcceptError } = await invitee.client.rpc(
      'accept_workspace_invitation',
      { p_invitation_token: oldInvitation.invitation_token }
    );
    expect(oldAcceptError?.message).toContain('invitation has been revoked');

    const { error: newAcceptError } = await invitee.client.rpc(
      'accept_workspace_invitation',
      { p_invitation_token: newInvitation.invitation_token }
    );
    expect(newAcceptError).toBeNull();
    }));

  it('serializes concurrent resend into one pending invitation', () =>
    runWithCloudHarness(async (harness) => {
      const owner = await harness.createActor('owner');
      const invitee = await harness.createActor('invitee');
      const workspaceId = await createWorkspace(owner.client, harness);

      const attempts = await Promise.all([
        owner.client.rpc('create_workspace_invitation', {
          p_workspace_id: workspaceId,
          p_email: invitee.email
        }),
        owner.client.rpc('create_workspace_invitation', {
          p_workspace_id: workspaceId,
          p_email: invitee.email.toUpperCase()
        })
      ]);
      expect(attempts.map(({ error }) => error)).toEqual([null, null]);
      const invitations = attempts.map(({ data }) => {
        const invitation = Array.isArray(data) ? data[0] : data;
        expect(invitation).toEqual(
          expect.objectContaining({
            invitation_id: expect.any(String),
            invitation_token: expect.any(String)
          })
        );
        return invitation as CreatedInvitation;
      });
      for (const invitation of invitations) {
        harness.trackInvitation(invitation.invitation_id);
      }
      const firstInvitation = invitations[0];
      const secondInvitation = invitations[1];
      expect(firstInvitation).toBeDefined();
      expect(secondInvitation).toBeDefined();
      if (!firstInvitation || !secondInvitation) {
        throw new Error('Expected two invitation creation results');
      }
      expect(firstInvitation.invitation_id).not.toBe(
        secondInvitation.invitation_id
      );

      const { data: pendingRows, error: pendingError } = await owner.client
        .from('workspace_invitations')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('email', invitee.email)
        .eq('status', 'pending');
      expect(pendingError).toBeNull();
      expect(pendingRows).toHaveLength(1);

      const activeInvitation = invitations.find(
        ({ invitation_id }) => invitation_id === pendingRows?.[0]?.id
      );
      const invalidInvitation = invitations.find(
        ({ invitation_id }) => invitation_id !== pendingRows?.[0]?.id
      );
      expect(activeInvitation).toBeDefined();
      expect(invalidInvitation).toBeDefined();
      if (!activeInvitation || !invalidInvitation) {
        throw new Error('Expected one active and one invalidated invitation');
      }

      const { error: invalidAcceptError } = await invitee.client.rpc(
        'accept_workspace_invitation',
        { p_invitation_token: invalidInvitation.invitation_token }
      );
      expect(invalidAcceptError?.message).toContain(
        'invitation has been revoked'
      );

      const { error: activeAcceptError } = await invitee.client.rpc(
        'accept_workspace_invitation',
        { p_invitation_token: activeInvitation.invitation_token }
      );
      expect(activeAcceptError).toBeNull();
    }));

  it('does not create a duplicate membership when acceptance is repeated', () =>
    runWithCloudHarness(async (harness) => {
    const owner = await harness.createActor('owner');
    const invitee = await harness.createActor('invitee');
    const workspaceId = await createWorkspace(owner.client, harness);
    const invitation = await createInvitation(
      harness,
      owner,
      workspaceId,
      invitee.email
    );

    const { error: firstError } = await invitee.client.rpc(
      'accept_workspace_invitation',
      { p_invitation_token: invitation.invitation_token }
    );
    expect(firstError).toBeNull();

    const { error: duplicateError } = await invitee.client.rpc(
      'accept_workspace_invitation',
      { p_invitation_token: invitation.invitation_token }
    );
    expect(duplicateError?.message).toContain(
      'invitation has already been accepted'
    );
    expect(await membershipCount(invitee, workspaceId)).toBe(1);
    }));

  it('serializes concurrent acceptance into one membership', () =>
    runWithCloudHarness(async (harness) => {
    const owner = await harness.createActor('owner');
    const invitee = await harness.createActor('invitee');
    const workspaceId = await createWorkspace(owner.client, harness);
    const invitation = await createInvitation(
      harness,
      owner,
      workspaceId,
      invitee.email
    );

    const attempts = await Promise.all([
      invitee.client.rpc('accept_workspace_invitation', {
        p_invitation_token: invitation.invitation_token
      }),
      invitee.client.rpc('accept_workspace_invitation', {
        p_invitation_token: invitation.invitation_token
      })
    ]);

    expect(attempts.filter(({ error }) => error === null)).toHaveLength(1);
    expect(
      attempts.filter(({ error }) =>
        error?.message.includes('invitation has already been accepted')
      )
    ).toHaveLength(1);
    expect(await membershipCount(invitee, workspaceId)).toBe(1);
    }));

  it('stores only a digest of the one-time invitation token', () =>
    runWithCloudHarness(async (harness) => {
    const owner = await harness.createActor('owner');
    const invitee = await harness.createActor('invitee');
    const workspaceId = await createWorkspace(owner.client, harness);
    const invitation = await createInvitation(
      harness,
      owner,
      workspaceId,
      invitee.email
    );

    const { data: rows, error } = await owner.client
      .from('workspace_invitations')
      .select('*')
      .eq('id', invitation.invitation_id);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).not.toHaveProperty('token');
    expect(rows?.[0]).not.toHaveProperty('invitation_token');
    expect(rows?.[0]?.token_digest).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(rows?.[0]?.token_digest).not.toContain(
      invitation.invitation_token.replaceAll('-', '')
    );
    }));
});
