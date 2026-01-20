import { ConfigService } from '@nestjs/config';
import { vi, type Mock } from 'vitest';

/**
 * Creates a mock ConfigService with the provided configuration values.
 *
 * @param config - Object mapping config keys to their values
 * @param defaultValue - Optional default value to return for missing keys
 * @returns A mock ConfigService instance
 *
 * @example
 * ```ts
 * const configService = createMockConfigService({
 *   'pocketbase.url': 'http://localhost:8090',
 *   'pocketbase.adminEmail': 'admin@test.com',
 * });
 * ```
 */
export function createMockConfigService(
  config: Record<string, any> = {},
  defaultValue?: any
): ConfigService {
  return {
    get: vi.fn((key: string, fallback?: any) => {
      if (key in config) {
        return config[key];
      }
      return fallback ?? defaultValue;
    }),
  } as unknown as ConfigService;
}

/**
 * Type helper for mock config service
 */
export type MockConfigService = ReturnType<typeof createMockConfigService>;
