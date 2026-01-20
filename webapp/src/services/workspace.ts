import type { TypedPocketBase } from '@project/shared/types';
import {
  WorkspaceMutator,
  WorkspaceMemberMutator,
} from '@project/shared/mutator';
import type {
  Workspace,
  WorkspaceInput,
  WorkspaceMember,
} from '@project/shared';

/**
 * Workspace service that provides high-level workspace operations
 * Handles workspace CRUD and membership verification
 */
export class WorkspaceService {
  private workspaceMutator: WorkspaceMutator;
  private workspaceMemberMutator: WorkspaceMemberMutator;

  constructor(pb: TypedPocketBase) {
    this.workspaceMutator = new WorkspaceMutator(pb);
    this.workspaceMemberMutator = new WorkspaceMemberMutator(pb);
  }

  /**
   * Create a new workspace
   * @param input Workspace data
   * @returns The created workspace
   */
  async createWorkspace(input: WorkspaceInput): Promise<Workspace> {
    return this.workspaceMutator.create(input);
  }

  /**
   * Create a new workspace and add the user as a member
   * @param input Workspace data
   * @param userId User ID to add as a member
   * @returns The created workspace and membership
   */
  async createWorkspaceWithMembership(
    input: WorkspaceInput,
    userId: string
  ): Promise<{ workspace: Workspace; membership: WorkspaceMember }> {
    // Create the workspace
    const workspace = await this.workspaceMutator.create(input);

    // Create membership for the user
    const membership = await this.workspaceMemberMutator.create({
      WorkspaceRef: workspace.id,
      UserRef: userId,
    });

    return { workspace, membership };
  }

  /**
   * Get workspace by ID
   * @param id Workspace ID
   * @returns The workspace or null if not found
   */
  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.workspaceMutator.getById(id);
  }

  /**
   * Get workspace by slug
   * @param slug Workspace slug
   * @returns The workspace or null if not found
   */
  async getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    return this.workspaceMutator.getBySlug(slug);
  }

  /**
   * Update workspace
   * @param id Workspace ID
   * @param data Partial workspace data to update
   * @returns The updated workspace
   */
  async updateWorkspace(
    id: string,
    data: Partial<Workspace>
  ): Promise<Workspace> {
    return this.workspaceMutator.update(id, data);
  }

  /**
   * Delete workspace
   * @param id Workspace ID
   * @returns True if deleted successfully
   */
  async deleteWorkspace(id: string): Promise<boolean> {
    return this.workspaceMutator.delete(id);
  }

  /**
   * Verify if a user has membership in a workspace
   * @param userId User ID
   * @param workspaceId Workspace ID
   * @returns True if user is a member, false otherwise
   */
  async verifyMembership(
    userId: string,
    workspaceId: string
  ): Promise<boolean> {
    const membership = await this.workspaceMemberMutator.getByUserAndWorkspace(
      userId,
      workspaceId
    );
    return membership !== null;
  }

  /**
   * Get user's membership in a workspace
   * @param userId User ID
   * @param workspaceId Workspace ID
   * @returns The workspace member record or null if not found
   */
  async getMembership(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceMember | null> {
    return this.workspaceMemberMutator.getByUserAndWorkspace(
      userId,
      workspaceId
    );
  }

  /**
   * Get all workspaces a user is a member of
   * @param userId User ID
   * @returns List of workspace memberships
   */
  async getUserWorkspaces(userId: string): Promise<WorkspaceMember[]> {
    const result =
      await this.workspaceMemberMutator.getMembershipsByUser(userId);
    return result.items;
  }

  /**
   * Check if user has permission to perform an action in a workspace
   * Throws an error if user is not a member
   * @param userId User ID
   * @param workspaceId Workspace ID
   * @throws Error if user is not a member of the workspace
   */
  async requireMembership(userId: string, workspaceId: string): Promise<void> {
    const isMember = await this.verifyMembership(userId, workspaceId);
    if (!isMember) {
      throw new Error(
        `User ${userId} does not have permission to access workspace ${workspaceId}`
      );
    }
  }

  /**
   * Get all members of a workspace
   * @param workspaceId Workspace ID
   * @returns List of workspace members
   */
  async getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const result =
      await this.workspaceMemberMutator.getMembersByWorkspace(workspaceId);
    return result.items;
  }

  /**
   * Add a member to a workspace
   * @param workspaceId Workspace ID
   * @param userId User ID
   * @returns The created membership
   */
  async addMember(
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMember> {
    // Check if already a member
    const existing = await this.workspaceMemberMutator.getByUserAndWorkspace(
      userId,
      workspaceId
    );
    if (existing) {
      return existing;
    }

    return this.workspaceMemberMutator.create({
      WorkspaceRef: workspaceId,
      UserRef: userId,
    });
  }

  /**
   * Remove a member from a workspace
   * @param workspaceId Workspace ID
   * @param userId User ID
   * @returns True if removed successfully
   */
  async removeMember(workspaceId: string, userId: string): Promise<boolean> {
    const membership = await this.workspaceMemberMutator.getByUserAndWorkspace(
      userId,
      workspaceId
    );

    if (!membership) {
      return false;
    }

    // Ensure at least one member remains
    const allMembers = await this.getWorkspaceMembers(workspaceId);
    if (allMembers.length <= 1) {
      throw new Error('Cannot remove the last member of a workspace');
    }

    return this.workspaceMemberMutator.delete(membership.id);
  }
}

/**
 * Create a WorkspaceService instance from a PocketBase client
 */
export function createWorkspaceService(pb: TypedPocketBase): WorkspaceService {
  return new WorkspaceService(pb);
}
