import PocketBase from 'pocketbase';
import type { User, RegisterData, UserInput } from '@project/shared';
import type { TypedPocketBase } from '@project/shared/types';
import { parseAuthError, withRetry } from '@project/shared';
import { UserMutator } from '@project/shared/mutator';

/**
 * Authentication service that uses mutators and provides high-level auth operations
 */
export class AuthService {
  private pb: PocketBase;
  private userMutator: UserMutator;

  constructor(pb: PocketBase) {
    this.pb = pb;
    this.userMutator = new UserMutator(pb as unknown as TypedPocketBase);
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<User> {
    try {
      const authData = await withRetry(async () => {
        return await this.pb
          .collection('users')
          .authWithPassword(email, password);
      });
      return authData.record as User;
    } catch (error) {
      const parsedError = parseAuthError(error);
      throw new Error(parsedError.message);
    }
  }

  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<User> {
    try {
      // Create user using mutator (with retry handled by mutator)
      await this.userMutator.create(data);

      // Auto-login after registration with retry
      const authData = await withRetry(async () => {
        return await this.pb
          .collection('users')
          .authWithPassword(data.email, data.password);
      });

      return authData.record as User;
    } catch (error) {
      const parsedError = parseAuthError(error);
      throw new Error(parsedError.message);
    }
  }

  /**
   * Logout current user and clear all session data
   */
  logout(): void {
    try {
      this.pb.authStore.clear();

      // Clear any additional session storage if needed (browser only)
      if (typeof window !== 'undefined') {
        try {
          // Remove any app-specific localStorage items
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('app_')) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((key) => localStorage.removeItem(key));
        } catch (error) {
          console.warn('Error clearing additional session data:', error);
        }
      }
    } catch (error) {
      console.error('Logout error:', error);
      // Force clear even if there's an error
      this.pb.authStore.clear();
    }
  }

  /**
   * Get current authenticated user
   */
  getCurrentUser(): User | null {
    return this.pb.authStore.record as User | null;
  }

  /**
   * Check if user is authenticated and session is valid
   */
  isAuthenticated(): boolean {
    return this.pb.authStore.isValid && !!this.pb.authStore.record;
  }

  /**
   * Refresh authentication token
   */
  async refreshAuth(): Promise<User | null> {
    try {
      if (!this.pb.authStore.isValid) {
        return null;
      }

      const authData = await withRetry(async () => {
        return await this.pb.collection('users').authRefresh();
      });

      return authData.record as User;
    } catch (error) {
      console.warn('Auth refresh failed:', error);
      // Clear invalid session
      this.pb.authStore.clear();
      return null;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: Partial<UserInput>): Promise<User> {
    try {
      const record = await this.userMutator.update(userId, data);
      return record;
    } catch (error) {
      const parsedError = parseAuthError(error);
      throw new Error(parsedError.message);
    }
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    password: string,
    passwordConfirm: string
  ): Promise<User> {
    try {
      // Note: oldPassword is a PocketBase-specific field for password changes
      // The mutator's update method accepts Partial<User> which allows additional fields
      const record = await this.userMutator.update(userId, {
        oldPassword,
        password,
        passwordConfirm,
      } as Partial<User>);
      return record;
    } catch (error) {
      const parsedError = parseAuthError(error);
      throw new Error(parsedError.message);
    }
  }

  /**
   * Get the PocketBase client instance
   */
  getClient(): PocketBase {
    return this.pb;
  }

  /**
   * Get the user mutator instance
   */
  getUserMutator(): UserMutator {
    return this.userMutator;
  }
}

/**
 * Create an AuthService instance from a PocketBase client
 */
export function createAuthService(pb: PocketBase): AuthService {
  return new AuthService(pb);
}
