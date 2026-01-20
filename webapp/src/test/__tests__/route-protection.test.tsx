/**
 * Property-Based Test: Route Protection
 * Feature: auth-boilerplate, Property 10: Route Protection
 * Validates: Requirements 6.7
 *
 * Property: For any unauthenticated user attempting to access protected routes,
 * they should be redirected to the login page
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter, usePathname } from 'next/navigation';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { useAuth } from '@/hooks/use-auth';

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

// Mock auth hook
vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(),
}));

describe('Property Test: Route Protection', () => {
  const mockPush = vi.fn();
  const mockUseRouter = vi.mocked(useRouter);
  const mockUsePathname = vi.mocked(usePathname);
  const mockUseAuth = vi.mocked(useAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRouter.mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should redirect unauthenticated users to login page with return URL', async () => {
    // Property test with multiple path scenarios
    const testPaths = [
      '/profile',
      '/dashboard',
      '/settings',
      '/admin',
      '/protected/nested/route',
      '/user/123/edit',
    ];

    for (const pathname of testPaths) {
      // Reset mocks for each iteration
      mockPush.mockClear();

      // Setup: unauthenticated user
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        login: vi.fn(),
        signup: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        changePassword: vi.fn(),
      });

      mockUsePathname.mockReturnValue(pathname);

      // Render protected route
      render(
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      );

      // Verify redirect to login with return URL
      await waitFor(() => {
        const expectedUrl = `/login?returnUrl=${encodeURIComponent(pathname)}`;
        expect(mockPush).toHaveBeenCalledWith(expectedUrl);
      });

      // Verify protected content is not rendered
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    }
  });

  it('should render protected content for authenticated users', async () => {
    // Property test with multiple authenticated user scenarios
    const testUsers = [
      {
        id: '1',
        email: 'user1@example.com',
        name: 'User One',
        password: 'password123',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        collectionId: 'users',
        collectionName: 'users',
        expand: {},
      },
      {
        id: '2',
        email: 'user2@example.com',
        name: 'User Two',
        password: 'password123',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        collectionId: 'users',
        collectionName: 'users',
        expand: {},
      },
      {
        id: '3',
        email: 'admin@example.com',
        name: 'Admin User',
        password: 'password123',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        collectionId: 'users',
        collectionName: 'users',
        expand: {},
      },
    ];

    for (const user of testUsers) {
      // Setup: authenticated user
      mockUseAuth.mockReturnValue({
        user,
        isLoading: false,
        isAuthenticated: true,
        login: vi.fn(),
        signup: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        changePassword: vi.fn(),
      });

      mockUsePathname.mockReturnValue('/profile');

      // Render protected route
      const { unmount } = render(
        <ProtectedRoute>
          <div>Protected Content for {user.name}</div>
        </ProtectedRoute>
      );

      // Verify no redirect occurs
      expect(mockPush).not.toHaveBeenCalled();

      // Verify protected content is rendered
      expect(
        screen.getByText(`Protected Content for ${user.name}`)
      ).toBeInTheDocument();

      // Clean up for next iteration
      unmount();
    }
  });

  it('should show loading state while authentication is being checked', () => {
    // Property test: loading state should be consistent regardless of path
    const testPaths = ['/profile', '/dashboard', '/settings'];

    for (const pathname of testPaths) {
      // Setup: loading state
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
        isAuthenticated: false,
        login: vi.fn(),
        signup: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        changePassword: vi.fn(),
      });

      mockUsePathname.mockReturnValue(pathname);

      const { unmount } = render(
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      );

      // Verify loading spinner is shown
      expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();

      // Verify no redirect occurs during loading
      expect(mockPush).not.toHaveBeenCalled();

      // Verify protected content is not rendered during loading
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();

      unmount();
    }
  });

  it('should use custom redirect URL when provided', async () => {
    // Property test with different custom redirect URLs
    const customRedirects = ['/custom-login', '/auth/signin', '/login-page'];

    for (const redirectTo of customRedirects) {
      mockPush.mockClear();

      // Setup: unauthenticated user
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        login: vi.fn(),
        signup: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        changePassword: vi.fn(),
      });

      mockUsePathname.mockReturnValue('/protected');

      // Render with custom redirect
      render(
        <ProtectedRoute redirectTo={redirectTo}>
          <div>Protected Content</div>
        </ProtectedRoute>
      );

      // Verify redirect to custom URL with return URL
      await waitFor(() => {
        const expectedUrl = `${redirectTo}?returnUrl=${encodeURIComponent('/protected')}`;
        expect(mockPush).toHaveBeenCalledWith(expectedUrl);
      });
    }
  });
});
