import { describe, it, expect, vi } from 'vitest';
import { WorkspaceMemberMutator } from '../workspace-member';
import type { TypedPocketBase } from '../../types';

/**
 * `addByEmail` is the one method on this class that does not go through the record
 * API — it calls the elevated `pb_hooks` route, because resolving an email to a user
 * id needs superuser reads. What's worth testing is the wire contract and the error
 * behaviour, both of which differ from every other method here.
 */
function createMutator(send: ReturnType<typeof vi.fn>) {
  const pb = {
    send,
    collection: () => ({}),
  } as unknown as TypedPocketBase;
  return new WorkspaceMemberMutator(pb);
}

describe('WorkspaceMemberMutator.addByEmail', () => {
  it('POSTs the email to the workspace members route', async () => {
    const send = vi.fn().mockResolvedValue({
      id: 'wm-1',
      WorkspaceRef: 'ws-1',
      UserRef: 'u-2',
      created: true,
    });

    const result = await createMutator(send).addByEmail(
      'ws-1',
      'b@example.com'
    );

    expect(send).toHaveBeenCalledWith('/api/vw/workspaces/ws-1/members', {
      method: 'POST',
      body: { email: 'b@example.com' },
    });
    // Returned verbatim — the endpoint owns the shape, including `created`.
    expect(result).toEqual({
      id: 'wm-1',
      WorkspaceRef: 'ws-1',
      UserRef: 'u-2',
      created: true,
    });
  });

  it('URL-encodes the workspace id into the path', async () => {
    const send = vi.fn().mockResolvedValue({ created: false });

    await createMutator(send).addByEmail('ws/1', 'b@example.com');

    expect(send).toHaveBeenCalledWith(
      '/api/vw/workspaces/ws%2F1/members',
      expect.anything()
    );
  });

  it('propagates failures with their status instead of returning null', async () => {
    // The real contract: every READ on BaseMutator swallows a not-found into `null`.
    // This method must not, or the UI cannot tell "no such account" (404) from
    // "invalid email" (400).
    const notFound = Object.assign(
      new Error('No account exists for that email address.'),
      {
        status: 404,
      }
    );
    const send = vi.fn().mockRejectedValue(notFound);

    await expect(
      createMutator(send).addByEmail('ws-1', 'nobody@example.com')
    ).rejects.toMatchObject({ status: 404 });
  });
});
