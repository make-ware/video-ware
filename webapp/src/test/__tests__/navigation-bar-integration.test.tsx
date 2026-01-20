import { describe, it, expect, vi } from 'vitest';
import React from 'react';

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children?: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => {
    return React.createElement('a', { href, ...props }, children);
  },
}));

// Mock the mobile hook
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}));

// Mock PocketBase client
vi.mock('@/lib/pocketbase', () => ({
  default: {
    authStore: {
      isValid: false,
      model: null,
      onChange: vi.fn(() => vi.fn()),
      clear: vi.fn(),
    },
  },
  authHelpers: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  },
}));

describe('Navigation Bar Integration Tests', () => {
  it('should import NavigationBar component without errors', async () => {
    // Test that the component can be imported
    const { NavigationBar } =
      await import('@/components/layout/navigation-bar');

    // Verify the component is a function (React component)
    expect(typeof NavigationBar).toBe('function');
    expect(NavigationBar.name).toBe('NavigationBar');
  });

  it('should have proper component structure', async () => {
    const { NavigationBar } =
      await import('@/components/layout/navigation-bar');

    // Component should be defined
    expect(NavigationBar).toBeDefined();

    // Should be a React component (function)
    expect(typeof NavigationBar).toBe('function');
  });

  it('should export NavigationBar as named export', async () => {
    const navigationModule = await import('@/components/layout/navigation-bar');

    // Should have NavigationBar as named export
    expect(navigationModule.NavigationBar).toBeDefined();
    expect(typeof navigationModule.NavigationBar).toBe('function');
  });
});
