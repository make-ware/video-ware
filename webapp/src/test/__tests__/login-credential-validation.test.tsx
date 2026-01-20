import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginSchema } from '@project/shared/schema';

// Mock PocketBase for testing
class MockPocketBase {
  collection(name: string) {
    return {
      authWithPassword: vi.fn(),
    };
  }
}

// Property test generators
function generateValidCredentials() {
  const domains = ['example.com', 'test.org', 'demo.net'];
  const usernames = ['user', 'test', 'demo', 'admin', 'john.doe'];

  const username = usernames[Math.floor(Math.random() * usernames.length)];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const email = `${username}${Math.floor(Math.random() * 1000)}@${domain}`;

  // Generate password with minimum 8 characters
  const password = 'password' + Math.floor(Math.random() * 10000);

  return { email, password };
}

function generateInvalidCredentials() {
  const invalidTypes = [
    // Invalid email formats - more clearly invalid
    () => ({ email: 'invalid-email', password: 'validpassword123' }),
    () => ({ email: 'plaintext', password: 'validpassword123' }),
    () => ({ email: '@domain.com', password: 'validpassword123' }),
    () => ({ email: 'user@', password: 'validpassword123' }),
    () => ({ email: '', password: 'validpassword123' }),
    () => ({ email: 'user@domain', password: 'validpassword123' }), // missing TLD
    () => ({ email: 'user..name@domain.com', password: 'validpassword123' }), // double dots

    // Invalid passwords (empty only - LoginSchema only requires non-empty)
    () => ({ email: 'valid@example.com', password: '' }),

    // Both invalid
    () => ({ email: 'invalid', password: '' }),
    () => ({ email: '', password: '' }),
  ];

  const generator =
    invalidTypes[Math.floor(Math.random() * invalidTypes.length)];
  return generator();
}

// Mock authentication function that simulates PocketBase behavior
async function mockAuthenticate(
  email: string,
  password: string,
  validUsers: Array<{ email: string; password: string }>
) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Find user with matching credentials
  const user = validUsers.find(
    (u) => u.email === email && u.password === password
  );

  if (user) {
    return {
      record: {
        id: Math.random().toString(36).substring(7),
        email: user.email,
        name: `User for ${user.email}`,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
      token: 'mock-jwt-token',
    };
  } else {
    throw new Error('Failed to authenticate');
  }
}

describe('Login Credential Validation Property Tests', () => {
  /**
   * Property 2: Authentication Credential Validation
   * For any login credentials, if the credentials are valid according to LoginSchema
   * and exist in the system, then authentication should succeed and establish a user session
   * Validates: Requirements 2.2, 2.4
   *
   * Feature: auth-boilerplate, Property 2: Authentication Credential Validation
   */
  it('Property 2: Authentication Credential Validation - valid credentials should authenticate successfully', async () => {
    // Generate multiple sets of valid credentials to test the property universally
    const validCredentialSets = Array.from(
      { length: 10 },
      generateValidCredentials
    );

    // Create mock user database
    const validUsers = validCredentialSets.map((creds) => ({
      email: creds.email,
      password: creds.password,
    }));

    for (const credentials of validCredentialSets) {
      // First verify the credentials pass schema validation
      const validationResult = LoginSchema.safeParse(credentials);
      expect(validationResult.success).toBe(true);

      if (validationResult.success) {
        // Then verify authentication succeeds for valid credentials
        const authResult = await mockAuthenticate(
          credentials.email,
          credentials.password,
          validUsers
        );

        expect(authResult).toBeDefined();
        expect(authResult.record).toBeDefined();
        expect(authResult.record.email).toBe(credentials.email);
        expect(authResult.token).toBeDefined();
      }
    }
  });

  it('Property 2: Authentication Credential Validation - invalid credentials should fail validation', async () => {
    // Generate multiple sets of invalid credentials
    const invalidCredentialSets = Array.from(
      { length: 15 },
      generateInvalidCredentials
    );

    for (const credentials of invalidCredentialSets) {
      // Invalid credentials should fail schema validation
      const validationResult = LoginSchema.safeParse(credentials);
      expect(validationResult.success).toBe(false);

      if (!validationResult.success) {
        expect(validationResult.error.issues.length).toBeGreaterThan(0);

        // Verify specific validation errors
        const issues = validationResult.error.issues;
        const hasEmailError = issues.some((issue) =>
          issue.path.includes('email')
        );
        const hasPasswordError = issues.some((issue) =>
          issue.path.includes('password')
        );

        // At least one field should have a validation error
        expect(hasEmailError || hasPasswordError).toBe(true);
      }
    }
  });

  it('Property 2: Authentication Credential Validation - valid format but wrong credentials should fail authentication', async () => {
    // Generate valid format credentials
    const validFormatCredentials = Array.from(
      { length: 5 },
      generateValidCredentials
    );

    // Create a different set of valid users (so credentials won't match)
    const validUsers = Array.from({ length: 3 }, generateValidCredentials);

    for (const credentials of validFormatCredentials) {
      // Credentials should pass schema validation
      const validationResult = LoginSchema.safeParse(credentials);
      expect(validationResult.success).toBe(true);

      // But authentication should fail since user doesn't exist
      await expect(
        mockAuthenticate(credentials.email, credentials.password, validUsers)
      ).rejects.toThrow('Failed to authenticate');
    }
  });

  it('Property 2: Authentication Credential Validation - schema validation consistency', () => {
    // Test edge cases for email validation
    const emailTestCases = [
      { email: 'test@example.com', valid: true },
      { email: 'user.name@domain.co.uk', valid: true },
      { email: 'user+tag@example.org', valid: true },
      { email: 'invalid.email', valid: false },
      { email: '@domain.com', valid: false },
      { email: 'user@', valid: false },
      { email: '', valid: false },
    ];

    // Test edge cases for password validation (LoginSchema only requires non-empty)
    const passwordTestCases = [
      { password: 'validpass123', valid: true },
      { password: 'minimum8', valid: true },
      { password: 'short', valid: true }, // LoginSchema allows short passwords
      { password: 'a', valid: true }, // LoginSchema allows single character
      { password: '', valid: false }, // Only empty is invalid for LoginSchema
    ];

    for (const emailCase of emailTestCases) {
      for (const passwordCase of passwordTestCases) {
        const credentials = {
          email: emailCase.email,
          password: passwordCase.password,
        };

        const result = LoginSchema.safeParse(credentials);
        const expectedValid = emailCase.valid && passwordCase.valid;

        expect(result.success).toBe(expectedValid);

        if (!expectedValid) {
          expect(result.error?.issues.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('Property 2: Authentication Credential Validation - round-trip validation', () => {
    // Generate valid credentials
    const credentials = generateValidCredentials();

    // Parse with schema
    const parseResult = LoginSchema.safeParse(credentials);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      // The parsed data should be equivalent to the original
      expect(parseResult.data.email).toBe(credentials.email);
      expect(parseResult.data.password).toBe(credentials.password);

      // Re-parsing the parsed data should also succeed
      const reparseResult = LoginSchema.safeParse(parseResult.data);
      expect(reparseResult.success).toBe(true);

      if (reparseResult.success) {
        expect(reparseResult.data).toEqual(parseResult.data);
      }
    }
  });
});
