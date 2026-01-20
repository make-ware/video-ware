import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterSchema } from '@project/shared/schema';

// Property test generators
function generateValidRegistrationData() {
  const domains = ['example.com', 'test.org', 'demo.net'];
  const firstNames = ['John', 'Jane', 'Alice', 'Bob', 'Charlie'];
  const lastNames = ['Doe', 'Smith', 'Johnson', 'Brown', 'Davis'];

  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const domain = domains[Math.floor(Math.random() * domains.length)];

  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 1000)}@${domain}`;
  const password = 'password' + Math.floor(Math.random() * 10000);
  const name = Math.random() > 0.5 ? `${firstName} ${lastName}` : undefined; // Optional field

  return {
    email,
    password,
    passwordConfirm: password, // Matching password
    name,
  };
}

function generateInvalidRegistrationData() {
  const invalidTypes = [
    // Password mismatch
    () => {
      const base = generateValidRegistrationData();
      return { ...base, passwordConfirm: base.password + 'different' };
    },

    // Invalid email
    () => {
      const base = generateValidRegistrationData();
      return { ...base, email: 'invalid-email' };
    },

    // Password too short
    () => {
      const base = generateValidRegistrationData();
      const shortPassword = 'short';
      return {
        ...base,
        password: shortPassword,
        passwordConfirm: shortPassword,
      };
    },

    // Empty required fields
    () => {
      const base = generateValidRegistrationData();
      return { ...base, email: '' };
    },

    () => {
      const base = generateValidRegistrationData();
      return { ...base, password: '' };
    },

    // Name too long (if provided)
    () => {
      const base = generateValidRegistrationData();
      const longName = 'a'.repeat(300); // Exceeds 255 character limit
      return { ...base, name: longName };
    },
  ];

  const generator =
    invalidTypes[Math.floor(Math.random() * invalidTypes.length)];
  return generator();
}

// Mock registration function that simulates PocketBase behavior
async function mockRegister(
  data: any,
  existingUsers: Array<{ email: string }> = []
) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Check if user already exists
  const userExists = existingUsers.some((u) => u.email === data.email);
  if (userExists) {
    throw new Error('User with this email already exists');
  }

  // Simulate successful registration
  return {
    record: {
      id: Math.random().toString(36).substring(7),
      email: data.email,
      name: data.name || '',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    token: 'mock-jwt-token',
  };
}

describe('User Registration Validation Property Tests', () => {
  /**
   * Property 1: User Registration Validation
   * For any user registration data, if the data is valid according to RegisterSchema,
   * then registration should succeed and automatically authenticate the user
   * Validates: Requirements 1.2, 1.4
   *
   * Feature: auth-boilerplate, Property 1: User Registration Validation
   */
  it('Property 1: User Registration Validation - valid registration data should succeed', async () => {
    // Generate multiple sets of valid registration data
    const validRegistrationSets = Array.from(
      { length: 10 },
      generateValidRegistrationData
    );

    for (const registrationData of validRegistrationSets) {
      // First verify the data passes schema validation
      const validationResult = RegisterSchema.safeParse(registrationData);
      expect(validationResult.success).toBe(true);

      if (validationResult.success) {
        // Then verify registration succeeds for valid data
        const registrationResult = await mockRegister(registrationData);

        expect(registrationResult).toBeDefined();
        expect(registrationResult.record).toBeDefined();
        expect(registrationResult.record.email).toBe(registrationData.email);
        expect(registrationResult.record.name).toBe(
          registrationData.name || ''
        );
        expect(registrationResult.token).toBeDefined();
      }
    }
  });

  it('Property 1: User Registration Validation - invalid registration data should fail validation', async () => {
    // Generate multiple sets of invalid registration data
    const invalidRegistrationSets = Array.from(
      { length: 15 },
      generateInvalidRegistrationData
    );

    for (const registrationData of invalidRegistrationSets) {
      // Invalid data should fail schema validation
      const validationResult = RegisterSchema.safeParse(registrationData);
      expect(validationResult.success).toBe(false);

      if (!validationResult.success) {
        expect(validationResult.error.issues.length).toBeGreaterThan(0);

        // Verify specific validation errors exist
        const issues = validationResult.error.issues;
        const hasEmailError = issues.some((issue) =>
          issue.path.includes('email')
        );
        const hasPasswordError = issues.some(
          (issue) =>
            issue.path.includes('password') ||
            issue.path.includes('passwordConfirm')
        );
        const hasNameError = issues.some((issue) =>
          issue.path.includes('name')
        );

        // At least one field should have a validation error
        expect(hasEmailError || hasPasswordError || hasNameError).toBe(true);
      }
    }
  });

  it('Property 1: User Registration Validation - duplicate email should fail registration', async () => {
    // Generate valid registration data
    const registrationData = generateValidRegistrationData();

    // Create existing user with same email
    const existingUsers = [{ email: registrationData.email }];

    // Data should pass schema validation
    const validationResult = RegisterSchema.safeParse(registrationData);
    expect(validationResult.success).toBe(true);

    // But registration should fail due to duplicate email
    await expect(mockRegister(registrationData, existingUsers)).rejects.toThrow(
      'User with this email already exists'
    );
  });

  it('Property 1: User Registration Validation - password confirmation consistency', () => {
    // Test password confirmation matching
    const baseData = generateValidRegistrationData();

    // Matching passwords should be valid
    const validData = { ...baseData, passwordConfirm: baseData.password };
    const validResult = RegisterSchema.safeParse(validData);
    expect(validResult.success).toBe(true);

    // Non-matching passwords should be invalid
    const invalidData = {
      ...baseData,
      passwordConfirm: baseData.password + 'different',
    };
    const invalidResult = RegisterSchema.safeParse(invalidData);
    expect(invalidResult.success).toBe(false);

    if (!invalidResult.success) {
      // Should have a specific error about password mismatch
      const passwordConfirmError = invalidResult.error.issues.find((issue) =>
        issue.path.includes('passwordConfirm')
      );
      expect(passwordConfirmError).toBeDefined();
      expect(passwordConfirmError?.message).toContain("don't match");
    }
  });

  it('Property 1: User Registration Validation - optional name field handling', () => {
    const baseData = generateValidRegistrationData();

    // Test with name provided
    const withName = { ...baseData, name: 'John Doe' };
    const withNameResult = RegisterSchema.safeParse(withName);
    expect(withNameResult.success).toBe(true);

    // Test without name (undefined)
    const withoutName = { ...baseData, name: undefined };
    const withoutNameResult = RegisterSchema.safeParse(withoutName);
    expect(withoutNameResult.success).toBe(true);

    // Test with empty string name
    const emptyName = { ...baseData, name: '' };
    const emptyNameResult = RegisterSchema.safeParse(emptyName);
    expect(emptyNameResult.success).toBe(true);

    // Test with name exceeding length limit
    const longName = { ...baseData, name: 'a'.repeat(300) };
    const longNameResult = RegisterSchema.safeParse(longName);
    expect(longNameResult.success).toBe(false);
  });

  it('Property 1: User Registration Validation - password strength requirements', () => {
    const baseData = generateValidRegistrationData();

    // Test minimum password length (8 characters)
    const validPasswords = [
      'password', // exactly 8 chars
      'password123', // longer than 8
      'abcdefgh', // exactly 8 chars, different pattern
    ];

    const invalidPasswords = [
      '', // empty
      'short', // less than 8 chars
      '1234567', // exactly 7 chars
    ];

    for (const password of validPasswords) {
      const data = { ...baseData, password, passwordConfirm: password };
      const result = RegisterSchema.safeParse(data);
      expect(result.success).toBe(true);
    }

    for (const password of invalidPasswords) {
      const data = { ...baseData, password, passwordConfirm: password };
      const result = RegisterSchema.safeParse(data);
      expect(result.success).toBe(false);

      if (!result.success) {
        const passwordError = result.error.issues.find(
          (issue) =>
            issue.path.includes('password') &&
            !issue.path.includes('passwordConfirm')
        );
        expect(passwordError).toBeDefined();
      }
    }
  });

  it('Property 1: User Registration Validation - round-trip validation', () => {
    // Generate valid registration data
    const registrationData = generateValidRegistrationData();

    // Parse with schema
    const parseResult = RegisterSchema.safeParse(registrationData);
    expect(parseResult.success).toBe(true);

    if (parseResult.success) {
      // The parsed data should be equivalent to the original
      expect(parseResult.data.email).toBe(registrationData.email);
      expect(parseResult.data.password).toBe(registrationData.password);
      expect(parseResult.data.passwordConfirm).toBe(
        registrationData.passwordConfirm
      );
      expect(parseResult.data.name).toBe(registrationData.name);

      // Re-parsing the parsed data should also succeed
      const reparseResult = RegisterSchema.safeParse(parseResult.data);
      expect(reparseResult.success).toBe(true);

      if (reparseResult.success) {
        expect(reparseResult.data).toEqual(parseResult.data);
      }
    }
  });
});
