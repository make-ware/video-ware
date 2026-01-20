import { describe, it, expect } from 'vitest';
import { LoginSchema, RegisterSchema } from '@project/shared/schema';

// Property test generators for invalid form inputs
function generateInvalidEmailInputs() {
  return [
    '', // empty
    'invalid', // no @ symbol
    '@domain.com', // missing local part
    'user@', // missing domain
    'user@domain', // missing TLD
    'user..name@domain.com', // double dots
    'user@domain..com', // double dots in domain
    'user name@domain.com', // space in local part
    'user@domain .com', // space in domain
  ];
}

function generateInvalidPasswordInputs() {
  return [
    '', // empty
    'short', // less than 8 characters
    '1234567', // exactly 7 characters
    'a', // single character
    '12345', // 5 characters
  ];
}

function generateValidEmailInputs() {
  return [
    'user@example.com',
    'test.email@domain.org',
    'user+tag@example.net',
    'firstname.lastname@company.co.uk',
    'user123@test-domain.com',
    'a@b.co', // minimal valid email
  ];
}

function generateValidPasswordInputs() {
  return [
    'password', // exactly 8 characters
    'password123', // longer password
    'mypassword', // 10 characters
    'verylongpasswordwithmanycharacters', // very long
    '12345678', // numeric password (8 chars)
    'P@ssw0rd!', // complex password
  ];
}

describe('Form Validation Consistency Property Tests', () => {
  /**
   * Property 3: Form Validation Consistency
   * For any invalid form input across all authentication forms,
   * the system should display appropriate validation errors without submitting the form
   * Validates: Requirements 1.3, 2.3, 8.1
   *
   * Feature: auth-boilerplate, Property 3: Form Validation Consistency
   */
  it('Property 3: Form Validation Consistency - invalid emails should be rejected consistently', () => {
    const invalidEmails = generateInvalidEmailInputs();
    const validPassword = 'validpassword123';

    for (const invalidEmail of invalidEmails) {
      // Test in login form
      const loginResult = LoginSchema.safeParse({
        email: invalidEmail,
        password: validPassword,
      });
      expect(loginResult.success).toBe(false);

      if (!loginResult.success) {
        const emailError = loginResult.error.issues.find((issue) =>
          issue.path.includes('email')
        );
        expect(emailError).toBeDefined();
        expect(emailError?.message).toBeTruthy();
      }

      // Test in registration form
      const registerResult = RegisterSchema.safeParse({
        email: invalidEmail,
        password: validPassword,
        passwordConfirm: validPassword,
        name: 'Test User',
      });
      expect(registerResult.success).toBe(false);

      if (!registerResult.success) {
        const emailError = registerResult.error.issues.find((issue) =>
          issue.path.includes('email')
        );
        expect(emailError).toBeDefined();
        expect(emailError?.message).toBeTruthy();
      }
    }
  });

  it('Property 3: Form Validation Consistency - invalid passwords should be rejected consistently', () => {
    const invalidPasswords = generateInvalidPasswordInputs();
    const validEmail = 'test@example.com';

    for (const invalidPassword of invalidPasswords) {
      // Test in login form (LoginSchema only requires non-empty password)
      const loginResult = LoginSchema.safeParse({
        email: validEmail,
        password: invalidPassword,
      });

      // LoginSchema should only reject empty passwords
      const shouldLoginFail = invalidPassword === '';
      expect(loginResult.success).toBe(!shouldLoginFail);

      if (shouldLoginFail && !loginResult.success) {
        const passwordError = loginResult.error.issues.find((issue) =>
          issue.path.includes('password')
        );
        expect(passwordError).toBeDefined();
        expect(passwordError?.message).toBeTruthy();
      }

      // Test in registration form (RegisterSchema requires min 8 characters)
      const registerResult = RegisterSchema.safeParse({
        email: validEmail,
        password: invalidPassword,
        passwordConfirm: invalidPassword,
        name: 'Test User',
      });

      // RegisterSchema should reject all invalid passwords (empty or < 8 chars)
      expect(registerResult.success).toBe(false);

      if (!registerResult.success) {
        const passwordError = registerResult.error.issues.find(
          (issue) =>
            issue.path.includes('password') &&
            !issue.path.includes('passwordConfirm')
        );
        expect(passwordError).toBeDefined();
        expect(passwordError?.message).toBeTruthy();
      }
    }
  });

  it('Property 3: Form Validation Consistency - valid inputs should be accepted consistently', () => {
    const validEmails = generateValidEmailInputs();
    const validPasswords = generateValidPasswordInputs();

    for (const email of validEmails) {
      for (const password of validPasswords) {
        // Test in login form
        const loginResult = LoginSchema.safeParse({
          email,
          password,
        });
        expect(loginResult.success).toBe(true);

        // Test in registration form
        const registerResult = RegisterSchema.safeParse({
          email,
          password,
          passwordConfirm: password,
          name: 'Test User',
        });
        expect(registerResult.success).toBe(true);
      }
    }
  });

  it('Property 3: Form Validation Consistency - error message structure consistency', () => {
    const testCases = [
      { email: '', password: 'validpassword123' },
      { email: 'invalid-email', password: 'validpassword123' },
      { email: 'valid@example.com', password: '' },
      { email: 'valid@example.com', password: 'short' },
    ];

    for (const testCase of testCases) {
      // Test login form error structure
      const loginResult = LoginSchema.safeParse(testCase);
      if (!loginResult.success) {
        for (const issue of loginResult.error.issues) {
          // Each error should have a path and message
          expect(issue.path).toBeDefined();
          expect(issue.message).toBeDefined();
          expect(typeof issue.message).toBe('string');
          expect(issue.message.length).toBeGreaterThan(0);
        }
      }

      // Test registration form error structure
      const registerResult = RegisterSchema.safeParse({
        ...testCase,
        passwordConfirm: testCase.password,
        name: 'Test User',
      });
      if (!registerResult.success) {
        for (const issue of registerResult.error.issues) {
          // Each error should have a path and message
          expect(issue.path).toBeDefined();
          expect(issue.message).toBeDefined();
          expect(typeof issue.message).toBe('string');
          expect(issue.message.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('Property 3: Form Validation Consistency - field-specific validation rules', () => {
    // Test email field validation consistency
    const emailTestCases = [
      { input: 'valid@example.com', shouldPass: true },
      { input: 'invalid-email', shouldPass: false },
      { input: '', shouldPass: false },
    ];

    for (const testCase of emailTestCases) {
      const loginData = { email: testCase.input, password: 'validpassword123' };
      const registerData = {
        email: testCase.input,
        password: 'validpassword123',
        passwordConfirm: 'validpassword123',
        name: 'Test User',
      };

      const loginResult = LoginSchema.safeParse(loginData);
      const registerResult = RegisterSchema.safeParse(registerData);

      // Both forms should have consistent email validation
      expect(loginResult.success).toBe(testCase.shouldPass);
      expect(registerResult.success).toBe(testCase.shouldPass);

      if (!testCase.shouldPass) {
        // Both should have email-related errors
        const loginEmailError = loginResult.error?.issues.some((issue) =>
          issue.path.includes('email')
        );
        const registerEmailError = registerResult.error?.issues.some((issue) =>
          issue.path.includes('email')
        );

        expect(loginEmailError).toBe(true);
        expect(registerEmailError).toBe(true);
      }
    }

    // Test password field validation (acknowledging different requirements)
    const passwordTestCases = [
      {
        input: 'validpassword123',
        loginShouldPass: true,
        registerShouldPass: true,
      },
      { input: 'short', loginShouldPass: true, registerShouldPass: false }, // Different requirements
      { input: '', loginShouldPass: false, registerShouldPass: false },
    ];

    for (const testCase of passwordTestCases) {
      const loginData = {
        email: 'valid@example.com',
        password: testCase.input,
      };
      const registerData = {
        email: 'valid@example.com',
        password: testCase.input,
        passwordConfirm: testCase.input,
        name: 'Test User',
      };

      const loginResult = LoginSchema.safeParse(loginData);
      const registerResult = RegisterSchema.safeParse(registerData);

      // Forms have different password requirements, which is expected
      expect(loginResult.success).toBe(testCase.loginShouldPass);
      expect(registerResult.success).toBe(testCase.registerShouldPass);
    }
  });

  it('Property 3: Form Validation Consistency - multiple field validation', () => {
    // Test forms with multiple invalid fields
    const multipleErrorCases = [
      { email: '', password: '' },
      { email: 'invalid', password: '' }, // Only empty password is invalid for LoginSchema
      { email: '@domain.com', password: '' },
    ];

    for (const testCase of multipleErrorCases) {
      const loginResult = LoginSchema.safeParse(testCase);
      const registerResult = RegisterSchema.safeParse({
        ...testCase,
        passwordConfirm: testCase.password,
        name: 'Test User',
      });

      // Both should fail validation
      expect(loginResult.success).toBe(false);
      expect(registerResult.success).toBe(false);

      // Both should have at least one error
      expect(loginResult.error?.issues.length).toBeGreaterThan(0);
      expect(registerResult.error?.issues.length).toBeGreaterThan(0);

      // Both should have errors for email (since all test cases have invalid emails)
      const loginHasEmailError = loginResult.error?.issues.some((issue) =>
        issue.path.includes('email')
      );
      const registerHasEmailError = registerResult.error?.issues.some((issue) =>
        issue.path.includes('email')
      );

      expect(loginHasEmailError).toBe(true);
      expect(registerHasEmailError).toBe(true);

      // Both should have password errors (since all test cases have empty passwords)
      const loginHasPasswordError = loginResult.error?.issues.some((issue) =>
        issue.path.includes('password')
      );
      const registerHasPasswordError = registerResult.error?.issues.some(
        (issue) =>
          issue.path.includes('password') &&
          !issue.path.includes('passwordConfirm')
      );

      expect(loginHasPasswordError).toBe(true);
      expect(registerHasPasswordError).toBe(true);
    }
  });

  it('Property 3: Form Validation Consistency - validation timing consistency', () => {
    // Test that validation behaves consistently regardless of input order
    const testData = {
      email: 'test@example.com',
      password: 'validpassword123',
    };

    // Parse multiple times to ensure consistency
    for (let i = 0; i < 5; i++) {
      const loginResult1 = LoginSchema.safeParse(testData);
      const loginResult2 = LoginSchema.safeParse({ ...testData });

      expect(loginResult1.success).toBe(loginResult2.success);

      if (loginResult1.success && loginResult2.success) {
        expect(loginResult1.data).toEqual(loginResult2.data);
      }

      const registerData = {
        ...testData,
        passwordConfirm: testData.password,
        name: 'Test User',
      };

      const registerResult1 = RegisterSchema.safeParse(registerData);
      const registerResult2 = RegisterSchema.safeParse({ ...registerData });

      expect(registerResult1.success).toBe(registerResult2.success);

      if (registerResult1.success && registerResult2.success) {
        expect(registerResult1.data).toEqual(registerResult2.data);
      }
    }
  });
});
