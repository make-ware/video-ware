import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthContext } from '@/contexts/auth-context';
import { ProfileForm } from '@/components/auth/profile-form';

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

// Mock auth context provider for testing
function MockAuthProvider({
  children,
  user,
  isAuthenticated = false,
  isLoading = false,
}: {
  children: React.ReactNode;
  user?: any;
  isAuthenticated?: boolean;
  isLoading?: boolean;
}) {
  const mockValue = {
    user: user || null,
    isLoading,
    isAuthenticated,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  };

  return (
    <AuthContext.Provider value={mockValue}>{children}</AuthContext.Provider>
  );
}

describe('Profile Data Display Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 8: Profile Data Display
   * For any authenticated user visiting the profile page, their current profile information
   * should be displayed correctly
   * Validates: Requirements 6.1
   * Feature: auth-boilerplate, Property 8: Profile Data Display
   */
  it('Property 8: Profile Data Display - should display current user profile information', () => {
    // Test with multiple random users to ensure property holds universally
    const testUsers = Array.from({ length: 10 }, generateRandomUser);

    for (const testUser of testUsers) {
      const { unmount } = render(
        <MockAuthProvider user={testUser} isAuthenticated={true}>
          <ProfileForm />
        </MockAuthProvider>
      );

      // Verify user's name is displayed in the form field
      const nameInput = screen.getByDisplayValue(testUser.name);
      expect(nameInput).toBeInTheDocument();
      expect(nameInput).toHaveAttribute('type', 'text');

      // Verify user's email is displayed in the form field
      const emailInput = screen.getByDisplayValue(testUser.email);
      expect(emailInput).toBeInTheDocument();
      expect(emailInput).toHaveAttribute('type', 'email');

      unmount();
    }
  });

  it('Property 8: Profile Data Display - should handle users with empty names', () => {
    // Test users with empty or undefined names
    const testUsers = Array.from({ length: 5 }, () => {
      const user = generateRandomUser();
      return { ...user, name: '' }; // Empty name
    });

    for (const testUser of testUsers) {
      const { unmount } = render(
        <MockAuthProvider user={testUser} isAuthenticated={true}>
          <ProfileForm />
        </MockAuthProvider>
      );

      // Name field should be empty but present
      const nameInput = screen.getByLabelText(/name/i);
      expect(nameInput).toBeInTheDocument();
      expect(nameInput).toHaveValue('');

      // Email should still be displayed correctly
      const emailInput = screen.getByDisplayValue(testUser.email);
      expect(emailInput).toBeInTheDocument();

      unmount();
    }
  });

  it('Property 8: Profile Data Display - should display profile form sections', () => {
    const testUsers = Array.from({ length: 3 }, generateRandomUser);

    for (const testUser of testUsers) {
      const { unmount } = render(
        <MockAuthProvider user={testUser} isAuthenticated={true}>
          <ProfileForm />
        </MockAuthProvider>
      );

      // Verify profile information section is present
      expect(screen.getByText('Profile Information')).toBeInTheDocument();
      expect(
        screen.getByText(/Update your personal information/i)
      ).toBeInTheDocument();

      // Verify password change section is present
      expect(screen.getAllByText('Change Password')[0]).toBeInTheDocument();
      expect(
        screen.getByText(/Update your password to keep/i)
      ).toBeInTheDocument();

      // Verify form fields are present
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(/enter your new password/i)
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(/confirm your new password/i)
      ).toBeInTheDocument();

      // Verify action buttons are present
      expect(
        screen.getByRole('button', { name: /update profile/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /change password/i })
      ).toBeInTheDocument();

      unmount();
    }
  });

  it('Property 8: Profile Data Display - should handle special characters in user data', () => {
    // Test users with special characters in names and emails
    const specialUsers = [
      {
        ...generateRandomUser(),
        name: 'José María',
        email: 'jose.maria@español.com',
      },
      { ...generateRandomUser(), name: '李小明', email: 'xiaoming@中文.org' },
      {
        ...generateRandomUser(),
        name: 'Müller-Schmidt',
        email: 'mueller@umlaut.de',
      },
      {
        ...generateRandomUser(),
        name: "O'Connor",
        email: 'oconnor@apostrophe.ie',
      },
    ];

    for (const testUser of specialUsers) {
      const { unmount } = render(
        <MockAuthProvider user={testUser} isAuthenticated={true}>
          <ProfileForm />
        </MockAuthProvider>
      );

      // Verify special characters are displayed correctly in form fields
      const nameInput = screen.getByDisplayValue(
        testUser.name
      ) as HTMLInputElement;
      expect(nameInput).toBeInTheDocument();
      expect(nameInput.value).toBe(testUser.name);

      const emailInput = screen.getByDisplayValue(
        testUser.email
      ) as HTMLInputElement;
      expect(emailInput).toBeInTheDocument();
      expect(emailInput.value).toBe(testUser.email);

      unmount();
    }
  });

  it('Property 8: Profile Data Display - should handle very long user data', () => {
    // Test users with very long names and emails
    const longDataUser = {
      ...generateRandomUser(),
      name: 'Bartholomew Maximilian Alexander Montgomery-Fitzpatrick III',
      email:
        'bartholomew.maximilian.alexander.montgomery.fitzpatrick.the.third@very-long-domain-name-for-testing-purposes.example.com',
    };

    render(
      <MockAuthProvider user={longDataUser} isAuthenticated={true}>
        <ProfileForm />
      </MockAuthProvider>
    );

    // Should display the full long name and email
    const nameInput = screen.getByDisplayValue(
      longDataUser.name
    ) as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe(longDataUser.name);

    const emailInput = screen.getByDisplayValue(
      longDataUser.email
    ) as HTMLInputElement;
    expect(emailInput).toBeInTheDocument();
    expect(emailInput.value).toBe(longDataUser.email);
  });

  it('Property 8: Profile Data Display - should show appropriate message for unauthenticated users', () => {
    render(
      <MockAuthProvider user={null} isAuthenticated={false}>
        <ProfileForm />
      </MockAuthProvider>
    );

    // Should display login prompt for unauthenticated users
    expect(
      screen.getByText(/Please log in to view your profile/i)
    ).toBeInTheDocument();

    // Should not display profile form fields
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /update profile/i })
    ).not.toBeInTheDocument();
  });

  it('Property 8: Profile Data Display - should maintain data consistency across form fields', () => {
    const testUser = generateRandomUser();

    render(
      <MockAuthProvider user={testUser} isAuthenticated={true}>
        <ProfileForm />
      </MockAuthProvider>
    );

    // Check that the same user data appears consistently in form fields
    const nameInput = screen.getByDisplayValue(
      testUser.name
    ) as HTMLInputElement;
    const emailInput = screen.getByDisplayValue(
      testUser.email
    ) as HTMLInputElement;

    expect(nameInput.value).toBe(testUser.name);
    expect(emailInput.value).toBe(testUser.email);

    // Verify the form fields are properly labeled and accessible
    expect(nameInput).toHaveAttribute('id', 'name');
    expect(emailInput).toHaveAttribute('id', 'email');

    // Verify labels are associated with inputs
    expect(screen.getByLabelText(/name/i)).toBe(nameInput);
    expect(screen.getByLabelText(/email/i)).toBe(emailInput);
  });

  it('Property 8: Profile Data Display - should handle undefined user properties gracefully', () => {
    // Test user with some undefined properties
    const partialUser = {
      id: 'test-id',
      email: 'test@example.com',
      // name is undefined
      password: 'password123',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      collectionId: 'users',
      collectionName: 'users',
      expand: {},
    };

    render(
      <MockAuthProvider user={partialUser} isAuthenticated={true}>
        <ProfileForm />
      </MockAuthProvider>
    );

    // Name field should be empty when name is undefined
    const nameInput = screen.getByLabelText(/name/i);
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveValue('');

    // Email should still be displayed correctly
    const emailInput = screen.getByDisplayValue(
      partialUser.email
    ) as HTMLInputElement;
    expect(emailInput).toBeInTheDocument();
    expect(emailInput.value).toBe(partialUser.email);
  });
});
