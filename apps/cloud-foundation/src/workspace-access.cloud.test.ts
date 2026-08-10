import { describe, expect, it } from 'vitest';
import {
  createWorkspace,
  runWithCloudHarness
} from './testHarness';

describe('workspace access', () => {
  it('isolates outsiders and preserves one admin across membership changes', async () => {
    await runWithCloudHarness(async (harness) => {
      const owner = await harness.createActor('owner');
      const member = await harness.createActor('member');
      const outsider = await harness.createActor('outsider');
      const workspaceId = await createWorkspace(
        owner.client,
        harness,
        ' 测试团队 '
      );
      const secondWorkspaceId = await createWorkspace(
        owner.client,
        harness,
        '第二个测试团队'
      );
    expect(secondWorkspaceId).not.toBe(workspaceId);

    const { data: creatorMemberships, error: creatorMembershipsError } =
      await owner.client
        .from('memberships')
        .select('user_id, role')
        .eq('workspace_id', workspaceId);
    expect(creatorMembershipsError).toBeNull();
    expect(creatorMemberships).toEqual([
      { user_id: owner.userId, role: 'admin' }
    ]);

    const { data: secondCreatorMemberships, error: secondMembershipsError } =
      await owner.client
        .from('memberships')
        .select('user_id, role')
        .eq('workspace_id', secondWorkspaceId);
    expect(secondMembershipsError).toBeNull();
    expect(secondCreatorMemberships).toEqual([
      { user_id: owner.userId, role: 'admin' }
    ]);

    const { data: workspaces, error: workspaceReadError } = await owner.client
      .from('workspaces')
      .select('id, name')
      .eq('id', workspaceId);
    expect(workspaceReadError).toBeNull();
    expect(workspaces).toEqual([{ id: workspaceId, name: '测试团队' }]);

    const { data: leakedRows, error: outsiderReadError } =
      await outsider.client
        .from('workspaces')
        .select('id')
        .eq('id', workspaceId);
    expect(outsiderReadError).toBeNull();
    expect(leakedRows).toEqual([]);

    const { error: outsiderRenameError } = await outsider.client.rpc(
      'rename_workspace',
      { p_workspace_id: workspaceId, p_name: '越权改名' }
    );
    expect(outsiderRenameError?.message).toContain('workspace admin required');

    const { error: lastAdminLeaveError } = await owner.client.rpc(
      'leave_workspace',
      { p_workspace_id: workspaceId }
    );
    expect(lastAdminLeaveError?.message).toContain(
      'workspace must retain an admin'
    );

    const { error: addMemberError } = await harness.admin
      .from('memberships')
      .insert({
        workspace_id: workspaceId,
        user_id: member.userId,
        role: 'member'
    });
    if (addMemberError) throw addMemberError;

    const { error: memberRenameError } = await member.client.rpc(
      'rename_workspace',
      { p_workspace_id: workspaceId, p_name: '成员越权改名' }
    );
    const { error: memberRemoveError } = await member.client.rpc(
      'remove_workspace_member',
      { p_workspace_id: workspaceId, p_user_id: owner.userId }
    );
    expect(memberRenameError?.message).toContain('workspace admin required');
    expect(memberRemoveError?.message).toContain('workspace admin required');

    const { error: directRoleWriteError } = await member.client
      .from('memberships')
      .update({ role: 'admin' })
      .eq('workspace_id', workspaceId)
      .eq('user_id', member.userId);
    expect(directRoleWriteError).not.toBeNull();

    const { error: memberPromoteError } = await member.client.rpc(
      'set_workspace_member_role',
      {
        p_workspace_id: workspaceId,
        p_user_id: member.userId,
        p_role: 'admin'
      }
    );
    expect(memberPromoteError?.message).toContain('workspace admin required');

    const { error: promoteError } = await owner.client.rpc(
      'set_workspace_member_role',
      {
        p_workspace_id: workspaceId,
        p_user_id: member.userId,
        p_role: 'admin'
      }
    );
    expect(promoteError).toBeNull();

    const { data: promotedMemberships, error: promotedMembershipsError } =
      await owner.client
        .from('memberships')
        .select('user_id, role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', member.userId);
    expect(promotedMembershipsError).toBeNull();
    expect(promotedMemberships).toEqual([
      { user_id: member.userId, role: 'admin' }
    ]);

    const { error: demoteMemberError } = await owner.client.rpc(
      'set_workspace_member_role',
      {
        p_workspace_id: workspaceId,
        p_user_id: member.userId,
        p_role: 'member'
      }
    );
    expect(demoteMemberError).toBeNull();

    const { error: finalAdminDemoteError } = await owner.client.rpc(
      'set_workspace_member_role',
      {
        p_workspace_id: workspaceId,
        p_user_id: owner.userId,
        p_role: 'member'
      }
    );
    expect(finalAdminDemoteError?.message).toContain(
      'workspace must retain an admin'
    );

    const { error: finalAdminRemoveError } = await owner.client.rpc(
      'remove_workspace_member',
      { p_workspace_id: workspaceId, p_user_id: owner.userId }
    );
    expect(finalAdminRemoveError?.message).toContain(
      'workspace must retain an admin'
    );

    const { error: removeMemberError } = await owner.client.rpc(
      'remove_workspace_member',
      { p_workspace_id: workspaceId, p_user_id: member.userId }
    );
    expect(removeMemberError).toBeNull();

    const { data: removedUserWorkspaceRows, error: removedWorkspaceReadError } =
      await member.client
        .from('workspaces')
        .select('id')
        .eq('id', workspaceId);
    expect(removedWorkspaceReadError).toBeNull();
    expect(removedUserWorkspaceRows).toEqual([]);

    const {
      data: removedUserMembershipRows,
      error: removedMembershipReadError
    } = await member.client
      .from('memberships')
      .select('workspace_id')
      .eq('workspace_id', workspaceId);
    expect(removedMembershipReadError).toBeNull();
    expect(removedUserMembershipRows).toEqual([]);
    });
  });
});
