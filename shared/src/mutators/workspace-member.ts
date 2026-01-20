import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { WorkspaceMemberInputSchema } from '../schema';
import type { WorkspaceMember, WorkspaceMemberInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

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
}
