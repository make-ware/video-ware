import { vi } from 'vitest';

/**
 * Mock Logger class that suppresses all console output during tests.
 * All log methods (log, error, warn, debug, verbose) are no-op functions
 * that do nothing when called.
 *
 * This class is used by vi.mock() calls in test files to replace the real Logger.
 */
export class MockLogger {
  constructor(private context?: string) {}

  // Use vi.fn() to create mock functions that can be spied on but do nothing by default
  log = vi.fn(() => {});
  error = vi.fn(() => {});
  warn = vi.fn(() => {});
  debug = vi.fn(() => {});
  verbose = vi.fn(() => {});
}

/**
 * Mock setup for @nestjs/common Logger.
 * This must be called at the top level of test files (not inside a function)
 * because vi.mock() is hoisted.
 *
 * @example
 * ```ts
 * import '@/__mocks__/logger';
 * ```
 *
 * Or use the inline pattern:
 * ```ts
 * vi.mock('@nestjs/common', async () => {
 *   const actual = await vi.importActual('@nestjs/common');
 *   const { MockLogger } = await import('@/__mocks__/logger');
 *   return {
 *     ...actual,
 *     Logger: MockLogger,
 *   };
 * });
 * ```
 */

// This mock is automatically applied when the module is imported
// However, since vi.mock() must be at the top level, we export the class
// and let each test file set up the mock using the pattern above
