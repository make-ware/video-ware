import type { TypedPocketBase } from '@project/shared/types';
import { UserMutator } from '@project/shared/mutator';
import type { User } from '@project/shared';
import type { ListResult } from 'pocketbase';

export class UserService {
  private userMutator: UserMutator;

  constructor(pb: TypedPocketBase) {
    this.userMutator = new UserMutator(pb);
  }

  /**
   * Search users by email or name
   * @param query Search query
   * @param page Page number
   * @param perPage Items per page
   * @returns List of users
   */
  async searchUsers(
    query: string,
    page = 1,
    perPage = 20
  ): Promise<ListResult<User>> {
    // Escape quotes in query
    const safeQuery = query.replace(/"/g, '\\"');
    const filter = `email ~ "${safeQuery}" || name ~ "${safeQuery}"`;
    return this.userMutator.getList(page, perPage, filter);
  }

  /**
   * Get user by ID
   * @param id User ID
   * @returns User
   */
  async getUser(id: string): Promise<User | null> {
    return this.userMutator.getById(id);
  }
}

export function createUserService(pb: TypedPocketBase): UserService {
  return new UserService(pb);
}
