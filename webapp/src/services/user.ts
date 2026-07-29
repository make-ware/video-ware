import type { TypedPocketBase } from '@project/shared/types';
import { UserMutator } from '@project/shared/mutator';
import type { User } from '@project/shared';

/**
 * Reads of other users' profiles.
 *
 * `Users` list/viewRule is scoped to yourself plus anyone who shares a workspace
 * with you (see `usersCollectionPermissions`), so everything here is co-member
 * scoped.
 *
 * NB: there is deliberately no `searchUsers`. A name/email search over this
 * collection can only ever return people who ALREADY share a workspace with you —
 * the exact complement of who you would want to add — so the add-member flow goes
 * through `WorkspaceService.addMemberByEmail` and its elevated PocketBase route
 * instead.
 */
export class UserService {
  private userMutator: UserMutator;

  constructor(pb: TypedPocketBase) {
    this.userMutator = new UserMutator(pb);
  }

  /**
   * Get user by ID
   * @param id User ID
   * @returns User, or null if not found or not visible to the caller
   */
  async getUser(id: string): Promise<User | null> {
    return this.userMutator.getById(id);
  }
}

export function createUserService(pb: TypedPocketBase): UserService {
  return new UserService(pb);
}
