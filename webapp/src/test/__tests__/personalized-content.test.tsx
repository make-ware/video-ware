import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import Home from '@/app/page';

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useParams: vi.fn(() => ({})),
}));

// Mock auth hook
vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(),
}));

// Mock workspace hook
vi.mock('@/hooks/use-workspace', () => ({
  useWorkspace: vi.fn(),
}));

// Property test generator for user data
function generateRandomUser() {
  const id = Math.random().toString(36).substring(7);
  const names = [
    'Alice',
    'Bob',
    'Charlie',
    'Diana',
    'Eve',
    'Frank',
    'Grace',
    'Henry',
  ];
  const domains = ['example.com', 'test.org', 'demo.net', 'sample.io'];

  const name =
    names[Math.floor(Math.random() * names.length)] +
    Math.random().toString(36).substring(2, 5);
  const email = `${name.toLowerCase()}@${domains[Math.floor(Math.random() * domains.length)]}`;

  return {
    id,
    name,
    email,
    password: 'password123',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    collectionId: 'users',
    collectionName: 'users',
    expand: {},
  };
}

// Helper to generate workspace
function generateWorkspace(id?: string) {
  return {
    id: id || Math.random().toString(36).substring(7),
    name: `Workspace ${Math.random().toString(36).substring(2, 7)}`,
    slug: `workspace-${Math.random().toString(36).substring(2, 7)}`,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    collectionId: 'workspaces',
    collectionName: 'workspaces',
    expand: {},
  };
}

describe('Personalized Content Property Tests', () => {
  const mockPush = vi.fn();
  const mockUseRouter = vi.mocked(useRouter);
  const mockUseAuth = vi.mocked(useAuth);
  const mockUseWorkspace = vi.mocked(useWorkspace);

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

  /**
   * Property 11: Personalized Content
   * For any authenticated user, the app should handle routing correctly
   * based on workspace availability
   * Validates: Requirements 5.2
   */
  it('Property 11: Personalized Content - should redirect authenticated users with workspace to media page', async () => {
    // Test with multiple random users to ensure property holds universally
    const testUsers = Array.from({ length: 5 }, generateRandomUser);

    for (const testUser of testUsers) {
      const workspace = generateWorkspace();

      mockUseAuth.mockReturnValue({
        user: testUser,
        isLoading: false,
        isAuthenticated: true,
        login: vi.fn(),
        signup: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        changePassword: vi.fn(),
      });

      mockUseWorkspace.mockReturnValue({
        currentWorkspace: workspace,
        workspaces: [],
        isLoading: false,
        error: null,
        switchWorkspace: vi.fn(),
        createWorkspace: vi.fn(),
        refreshWorkspaces: vi.fn(),
        clearError: vi.fn(),
        hasWorkspaces: true,
        currentMembership: null,
      });

      const { unmount } = render(<Home />);

      // Verify redirect to workspace media page
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(`/ws/${workspace.id}/media`);
      });

      unmount();
    }
  });

  it('Property 11: Personalized Content - should show workspace selection prompt when no workspace available', async () => {
    // Test users without workspaces
    const testUsers = Array.from({ length: 3 }, generateRandomUser);

    for (const testUser of testUsers) {
      mockUseAuth.mockReturnValue({
        user: testUser,
        isLoading: false,
        isAuthenticated: true,
        login: vi.fn(),
        signup: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        changePassword: vi.fn(),
      });

      mockUseWorkspace.mockReturnValue({
        currentWorkspace: null,
        workspaces: [],
        isLoading: false,
        error: null,
        switchWorkspace: vi.fn(),
        createWorkspace: vi.fn(),
        refreshWorkspaces: vi.fn(),
        clearError: vi.fn(),
        hasWorkspaces: false,
        currentMembership: null,
      });

      const { unmount } = render(<Home />);

      // Verify redirect to workspaces page
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/workspaces');
      });

      unmount();
      mockPush.mockClear();
    }
  });

  it('Property 11: Personalized Content - should show unauthenticated view for non-authenticated users', () => {
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

    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      isLoading: false,
      error: null,
      switchWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      clearError: vi.fn(),
      hasWorkspaces: false,
      currentMembership: null,
    });

    render(<Home />);

    // Verify unauthenticated view is shown
    // Use getAllByText since these texts appear multiple times in the page
    const videoWareElements = screen.getAllByText(/VideoWare/i);
    expect(videoWareElements.length).toBeGreaterThan(0);
    const editorElements = screen.getAllByText(/Web-Based Video Editor/i);
    expect(editorElements.length).toBeGreaterThan(0);
    const getStartedElements = screen.getAllByText(/Get Started/i);
    expect(getStartedElements.length).toBeGreaterThan(0);
    const signInElements = screen.getAllByText(/Sign In/i);
    expect(signInElements.length).toBeGreaterThan(0);
  });

  it('Property 11: Personalized Content - should show loading state while checking authentication', () => {
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

    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      isLoading: false,
      error: null,
      switchWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      clearError: vi.fn(),
      hasWorkspaces: false,
      currentMembership: null,
    });

    render(<Home />);

    // Verify loading spinner is shown
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('Property 11: Personalized Content - should show loading state while loading workspace', () => {
    const testUser = generateRandomUser();

    mockUseAuth.mockReturnValue({
      user: testUser,
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      signup: vi.fn(),
      logout: vi.fn(),
      updateProfile: vi.fn(),
      changePassword: vi.fn(),
    });

    mockUseWorkspace.mockReturnValue({
      currentWorkspace: null,
      workspaces: [],
      isLoading: true,
      error: null,
      switchWorkspace: vi.fn(),
      createWorkspace: vi.fn(),
      refreshWorkspaces: vi.fn(),
      clearError: vi.fn(),
      hasWorkspaces: false,
      currentMembership: null,
    });

    render(<Home />);

    // Verify loading spinner is shown
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('Property 11: Personalized Content - should maintain consistent routing behavior across different workspace IDs', async () => {
    const testUser = generateRandomUser();
    const workspaceIds = [
      'workspace-1',
      'workspace-2',
      'workspace-abc123',
      'workspace-long-id-123456789',
    ];

    for (const workspaceId of workspaceIds) {
      const workspace = generateWorkspace(workspaceId);

      mockUseAuth.mockReturnValue({
        user: testUser,
        isLoading: false,
        isAuthenticated: true,
        login: vi.fn(),
        signup: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        changePassword: vi.fn(),
      });

      mockUseWorkspace.mockReturnValue({
        currentWorkspace: workspace,
        workspaces: [],
        isLoading: false,
        error: null,
        switchWorkspace: vi.fn(),
        createWorkspace: vi.fn(),
        refreshWorkspaces: vi.fn(),
        clearError: vi.fn(),
        hasWorkspaces: true,
        currentMembership: null,
      });

      const { unmount } = render(<Home />);

      // Verify redirect uses correct workspace ID
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(`/ws/${workspaceId}/media`);
      });

      unmount();
      mockPush.mockClear();
    }
  });
});
