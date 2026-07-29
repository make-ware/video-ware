import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { WorkspaceMemberInputSchema } from '../schema';
import type { WorkspaceMember, WorkspaceMemberInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

/** Response of `POST /api/vw/workspaces/{workspaceId}/members`. */
export interface AddMemberByEmailResult {
  /** The WorkspaceMembers record id. */
  id: string;
  WorkspaceRef: string;
  UserRef: string;
  /** false when the account was already a member (idempotent no-op). */
  created: boolean;
}

export class WorkspaceMemberMutator extends BaseMutator<
  WorkspaceMember,
  WorkspaceMemberInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<WorkspaceMember> {
    return this.pb.collection('WorkspaceMembers');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'UserRef'],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(
    input: WorkspaceMemberInput
  ): Promise<WorkspaceMemberInput> {
    return WorkspaceMemberInputSchema.parse(input);
  }

  /**
   * Get workspace member by user and workspace
   * @param userId The user ID
   * @param workspaceId The workspace ID
   * @returns The workspace member or null if not found
   */
  async getByUserAndWorkspace(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceMember | null> {
    return this.getFirstByFilter(
      `UserRef = "${userId}" && WorkspaceRef = "${workspaceId}"`
    );
  }

  /**
   * Get all workspace memberships for a user
   * @param userId The user ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of workspace memberships
   */
  async getMembershipsByUser(
    userId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<WorkspaceMember>> {
    return this.getList(page, perPage, `UserRef = "${userId}"`);
  }

  /**
   * Get all members of a workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of workspace members
   */
  async getMembersByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<WorkspaceMember>> {
    return this.getList(
      page,
      perPage,
      `WorkspaceRef = "${workspaceId}"`,
      undefined,
      'UserRef'
    );
  }

  /**
   * Add an existing account to a workspace by its exact email address.
   *
   * Goes through the elevated `pb/pb_hooks/hook-workspace-members-add.pb.js` route
   * rather than creating the record directly, because resolving an email to a user
   * id needs superuser reads: `Users` list/viewRule only exposes co-members, i.e.
   * the people already in a workspace with you. The hook re-checks that the caller
   * is a member of `workspaceId` before it does anything.
   *
   * Idempotent — an account that is already a member comes back with
   * `created: false` and the existing record id.
   *
   * Unlike the reads on this class, failures deliberately PROPAGATE (as
   * `ClientResponseError`, carrying `status` and `message`) instead of collapsing
   * into `null`: the caller has to be able to tell "no such account" (404) from
   * "bad email" (400).
   *
   * @param workspaceId The workspace ID
   * @param email The exact email address of an existing account (case-sensitive)
   * @returns The membership, and whether it was newly created
   */
  async addByEmail(
    workspaceId: string,
    email: string
  ): Promise<AddMemberByEmailResult> {
    return this.pb.send<AddMemberByEmailResult>(
      `/api/vw/workspaces/${encodeURIComponent(workspaceId)}/members`,
      { method: 'POST', body: { email } }
    );
  }
}
