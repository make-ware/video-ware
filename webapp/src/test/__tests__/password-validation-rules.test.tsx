import { describe, it, expect } from 'vitest';
import { RegisterSchema } from '@project/shared/schema';

// Property test generators for password validation
function generateValidPasswords() {
  const patterns = [
    // Exactly minimum length
    () => 'password',
    () => 'abcdefgh',
    () => '12345678',

    // Longer than minimum
    () => 'password123',
    () => 'verylongpassword',
    () => 'thisIsAVeryLongPasswordWithManyCharacters',

    // Different character types
    () => 'Password123',
    () => 'P@ssw0rd!',
    () => 'mySecurePassword2024',
    () => 'simple_password_with_underscores',

    // Edge cases
    () => 'a'.repeat(8), // exactly 8 identical characters
    () => 'a'.repeat(100), // very long password
  ];

  return patterns.map((fn) => fn());
}

function generateInvalidPasswords() {
  return [
    '', // empty string
    'a', // 1 character
    'ab', // 2 characters
    'abc', // 3 characters
    'abcd', // 4 characters
    'abcde', // 5 characters
    'abcdef', // 6 characters
    'abcdefg', // 7 characters (just under minimum)
  ];
}

function generatePasswordConfirmationPairs() {
  const basePasswords = [
    'password123',
    'mySecurePass',
    'testPassword2024',
    'P@ssw0rd!',
  ];

  return basePasswords.map((password) => ({
    matching: { password, passwordConfirm: password },
    nonMatching: { password, passwordConfirm: password + 'different' },
  }));
}

describe('Password Validation Rules Property Tests', () => {
  /**
   * Property 4: Password Validation Rules
   * For any password input, passwords shorter than 8 characters should be rejected,
   * and password confirmation fields should match the original password
   * Validates: Requirements 1.6, 1.7
   *
   * Feature: auth-boilerplate, Property 4: Password Validation Rules
   */
  it('Property 4: Password Validation Rules - valid passwords should pass validation', () => {
    const validPasswords = generateValidPasswords();
    const testEmail = 'test@example.com';

    for (const password of validPasswords) {
      const registrationData = {
        email: testEmail,
        password,
        passwordConfirm: password,
        name: 'Test User',
      };

      const result = RegisterSchema.safeParse(registrationData);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.password).toBe(password);
        expect(result.data.passwordConfirm).toBe(password);
      }
    }
  });

  it('Property 4: Password Validation Rules - invalid passwords should be rejected', () => {
    const invalidPasswords = generateInvalidPasswords();
    const testEmail = 'test@example.com';

    for (const password of invalidPasswords) {
      const registrationData = {
        email: testEmail,
        password,
        passwordConfirm: password,
        name: 'Test User',
      };

      const result = RegisterSchema.safeParse(registrationData);
      expect(result.success).toBe(false);

      if (!result.success) {
        // Should have a password-related error
        const passwordError = result.error.issues.find(
          (issue) =>
            issue.path.includes('password') &&
            !issue.path.includes('passwordConfirm')
        );
        expect(passwordError).toBeDefined();
        expect(passwordError?.message).toContain('8 characters');
      }
    }
  });

  it('Property 4: Password Validation Rules - password confirmation matching', () => {
    const confirmationPairs = generatePasswordConfirmationPairs();
    const testEmail = 'test@example.com';

    for (const pair of confirmationPairs) {
      // Test matching passwords
      const matchingData = {
        email: testEmail,
        ...pair.matching,
        name: 'Test User',
      };

      const matchingResult = RegisterSchema.safeParse(matchingData);
      expect(matchingResult.success).toBe(true);

      // Test non-matching passwords
      const nonMatchingData = {
        email: testEmail,
        ...pair.nonMatching,
        name: 'Test User',
      };

      const nonMatchingResult = RegisterSchema.safeParse(nonMatchingData);
      expect(nonMatchingResult.success).toBe(false);

      if (!nonMatchingResult.success) {
        // Should have a password confirmation error
        const confirmError = nonMatchingResult.error.issues.find((issue) =>
          issue.path.includes('passwordConfirm')
        );
        expect(confirmError).toBeDefined();
        expect(confirmError?.message).toContain("don't match");
      }
    }
  });

  it('Property 4: Password Validation Rules - minimum length boundary testing', () => {
    const testEmail = 'test@example.com';

    // Test exactly 7 characters (should fail)
    const sevenCharPassword = 'a'.repeat(7);
    const sevenCharResult = RegisterSchema.safeParse({
      email: testEmail,
      password: sevenCharPassword,
      passwordConfirm: sevenCharPassword,
      name: 'Test User',
    });
    expect(sevenCharResult.success).toBe(false);

    // Test exactly 8 characters (should pass)
    const eightCharPassword = 'a'.repeat(8);
    const eightCharResult = RegisterSchema.safeParse({
      email: testEmail,
      password: eightCharPassword,
      passwordConfirm: eightCharPassword,
      name: 'Test User',
    });
    expect(eightCharResult.success).toBe(true);

    // Test 9 characters (should pass)
    const nineCharPassword = 'a'.repeat(9);
    const nineCharResult = RegisterSchema.safeParse({
      email: testEmail,
      password: nineCharPassword,
      passwordConfirm: nineCharPassword,
      name: 'Test User',
    });
    expect(nineCharResult.success).toBe(true);
  });

  it('Property 4: Password Validation Rules - password confirmation edge cases', () => {
    const testEmail = 'test@example.com';
    const basePassword = 'validpassword123';

    const edgeCases = [
      // Case sensitivity
      { password: basePassword, passwordConfirm: basePassword.toUpperCase() },

      // Extra whitespace
      { password: basePassword, passwordConfirm: basePassword + ' ' },
      { password: basePassword, passwordConfirm: ' ' + basePassword },

      // Similar but different
      { password: basePassword, passwordConfirm: basePassword + '1' },
      { password: basePassword, passwordConfirm: basePassword.slice(0, -1) },

      // Empty confirmation
      { password: basePassword, passwordConfirm: '' },
    ];

    for (const testCase of edgeCases) {
      const result = RegisterSchema.safeParse({
        email: testEmail,
        ...testCase,
        name: 'Test User',
      });

      expect(result.success).toBe(false);

      if (!result.success) {
        const confirmError = result.error.issues.find((issue) =>
          issue.path.includes('passwordConfirm')
        );
        expect(confirmError).toBeDefined();
      }
    }
  });

  it('Property 4: Password Validation Rules - combined validation scenarios', () => {
    const testEmail = 'test@example.com';

    const scenarios = [
      // Both password and confirmation invalid (too short)
      {
        password: 'short',
        passwordConfirm: 'short',
        expectPasswordError: true,
        expectConfirmError: false,
      },

      // Password too short, confirmation different
      {
        password: 'short',
        passwordConfirm: 'different',
        expectPasswordError: true,
        expectConfirmError: true,
      },

      // Password valid, confirmation different
      {
        password: 'validpassword123',
        passwordConfirm: 'different',
        expectPasswordError: false,
        expectConfirmError: true,
      },

      // Both valid and matching
      {
        password: 'validpassword123',
        passwordConfirm: 'validpassword123',
        expectPasswordError: false,
        expectConfirmError: false,
      },
    ];

    for (const scenario of scenarios) {
      const result = RegisterSchema.safeParse({
        email: testEmail,
        password: scenario.password,
        passwordConfirm: scenario.passwordConfirm,
        name: 'Test User',
      });

      const hasPasswordError =
        result.error?.issues.some(
          (issue) =>
            issue.path.includes('password') &&
            !issue.path.includes('passwordConfirm')
        ) || false;

      const hasConfirmError =
        result.error?.issues.some((issue) =>
          issue.path.includes('passwordConfirm')
        ) || false;

      expect(hasPasswordError).toBe(scenario.expectPasswordError);
      expect(hasConfirmError).toBe(scenario.expectConfirmError);

      const shouldPass =
        !scenario.expectPasswordError && !scenario.expectConfirmError;
      expect(result.success).toBe(shouldPass);
    }
  });

  it('Property 4: Password Validation Rules - character encoding and special characters', () => {
    const testEmail = 'test@example.com';

    const specialPasswordCases = [
      // Unicode characters
      'pässwörd123', // 12 characters with umlauts
      'пароль123456', // Cyrillic characters
      '密码12345678', // Chinese characters

      // Special symbols
      'P@ssw0rd!#$%',
      'password_with_underscores',
      'password-with-dashes',
      'password.with.dots',

      // Mixed case and numbers
      'MyP@ssW0rd123',
      'UPPERCASE123',
      'lowercase123',

      // Spaces (if allowed)
      'my password 123', // 15 characters including spaces
    ];

    for (const password of specialPasswordCases) {
      if (password.length >= 8) {
        const result = RegisterSchema.safeParse({
          email: testEmail,
          password,
          passwordConfirm: password,
          name: 'Test User',
        });

        expect(result.success).toBe(true);

        if (result.success) {
          expect(result.data.password).toBe(password);
          expect(result.data.passwordConfirm).toBe(password);
        }
      }
    }
  });

  it('Property 4: Password Validation Rules - validation consistency across multiple attempts', () => {
    const testEmail = 'test@example.com';
    const testPassword = 'consistentPassword123';

    // Test the same data multiple times to ensure consistent validation
    for (let i = 0; i < 10; i++) {
      const result = RegisterSchema.safeParse({
        email: testEmail,
        password: testPassword,
        passwordConfirm: testPassword,
        name: 'Test User',
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.password).toBe(testPassword);
        expect(result.data.passwordConfirm).toBe(testPassword);
      }
    }

    // Test invalid data multiple times
    const invalidPassword = 'short';
    for (let i = 0; i < 10; i++) {
      const result = RegisterSchema.safeParse({
        email: testEmail,
        password: invalidPassword,
        passwordConfirm: invalidPassword,
        name: 'Test User',
      });

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
});
