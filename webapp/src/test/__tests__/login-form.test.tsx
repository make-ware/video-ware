import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginForm } from '@/components/auth/login-form';
import { AuthProvider } from '@/contexts/auth-context';

// Use vi.hoisted() to ensure mocks are available when vi.mock() is hoisted
const { mockPb, mockAuthHelpers, mockCollection } = vi.hoisted(() => {
  const mockAuthHelpers = {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(() => null),
    isAuthenticated: vi.fn(() => false),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  };

  const mockAuthStore = {
    isValid: false,
    model: null,
    onChange: vi.fn(() => vi.fn()), // Returns unsubscribe function
    clear: vi.fn(),
  };

  const mockCollection = {
    authWithPassword: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const mockPb = {
    authStore: mockAuthStore,
    collection: vi.fn(() => mockCollection),
    autoCancellation: vi.fn(),
  };

  return { mockPb, mockAuthHelpers, mockCollection };
});

vi.mock('@/lib/pocketbase', () => ({
  default: mockPb,
  authHelpers: mockAuthHelpers,
  getUserCollection: () => mockCollection,
}));

describe('LoginForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderLoginForm = () => {
    return render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>
    );
  };

  it('renders login form with email and password fields', () => {
    renderLoginForm();

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign in/i })
    ).toBeInTheDocument();
  });

  it('renders remember me checkbox', () => {
    renderLoginForm();

    expect(
      screen.getByRole('checkbox', { name: /remember me/i })
    ).toBeInTheDocument();
  });

  it('renders sign up link with correct href', () => {
    renderLoginForm();

    const signUpLink = screen.getByRole('link', { name: /sign up/i });
    expect(signUpLink).toHaveAttribute('href', '/signup');
  });

  it('has email input with correct type attribute', () => {
    renderLoginForm();

    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('has password input with correct type attribute', () => {
    renderLoginForm();

    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
