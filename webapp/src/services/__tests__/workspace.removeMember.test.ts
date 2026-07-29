import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceService } from '../workspace';
import type { TypedPocketBase } from '@project/shared/types';
import type { WorkspaceMember } from '@project/shared';
import { createGenericMockCollection } from '@/test/__tests__/fixtures/pocketbase';

/**
 * `removeMember` holds the one guard that keeps a workspace reachable: it refuses to
 * delete the last membership row, which would orphan the workspace and everything in
 * it (Workspaces list/viewRule is membership-scoped, so nobody could ever see it
 * again — not even its creator).
 */
function createMockPocketBase() {
  const membersCollection = createGenericMockCollection<WorkspaceMember>(
    'WorkspaceMembers',
    () => `wm-${Math.random().toString(36).substring(7)}`
  );
  const stubCollection = createGenericMockCollection<any>('Stub');

  const pb = {
    authStore: { record: { id: 'user-1' } },
    collection: (name: string) =>
      name === 'WorkspaceMembers' ? membersCollection : stubCollection,
  } as unknown as TypedPocketBase;

  return { pb, membersCollection };
}

describe('WorkspaceService.removeMember', () => {
  let service: WorkspaceService;
  let membersCollection: ReturnType<
    typeof createGenericMockCollection<WorkspaceMember>
  >;

  beforeEach(() => {
    const mock = createMockPocketBase();
    membersCollection = mock.membersCollection;
    service = new WorkspaceService(mock.pb);
  });

  async function seedMember(id: string, userId: string, workspaceId = 'ws-1') {
    await membersCollection.create({
      id,
      WorkspaceRef: workspaceId,
      UserRef: userId,
    } as any);
  }

  it('removes a member when others remain', async () => {
    await seedMember('wm-1', 'user-1');
    await seedMember('wm-2', 'user-2');

    await expect(service.removeMember('ws-1', 'user-2')).resolves.toBe(true);
    expect(membersCollection.delete).toHaveBeenCalledWith('wm-2');
  });

  it('refuses to remove the last member', async () => {
    await seedMember('wm-1', 'user-1');

    await expect(service.removeMember('ws-1', 'user-1')).rejects.toThrow(
      'Cannot remove the last member of a workspace'
    );
    expect(membersCollection.delete).not.toHaveBeenCalled();
  });

  it('returns false rather than throwing when there is no such membership', async () => {
    await seedMember('wm-1', 'user-1');
    await seedMember('wm-2', 'user-2');

    // Distinct from the last-member case on purpose: a caller retrying a removal
    // that already landed should be a no-op, not an error.
    await expect(service.removeMember('ws-1', 'user-404')).resolves.toBe(false);
    expect(membersCollection.delete).not.toHaveBeenCalled();
  });
});
