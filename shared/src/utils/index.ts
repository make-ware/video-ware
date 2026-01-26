export * from './error-handling.js';
export * from './media-errors.js';
export * from './retry.js';
export * from './time.js';
export * from './edit-list.js';
export * from './query-hash.js';
export * from './composite-utils.js';

import { z } from 'zod';

/**
 * Validates data against a Zod schema and returns typed result
 */
export function validateSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, errors: result.error };
}

/**
 * Formats PocketBase errors for display
 */
export function formatPocketBaseError(error: {
  data?: Record<string, string[]>;
  message?: string;
}): string {
  if (error?.data) {
    const messages = Object.values(error.data).flat();
    return messages.join(', ');
  }

  return error?.message || 'An unexpected error occurred';
}

/**
 * Creates a type-safe PocketBase collection reference
 */
export function createCollectionRef(collectionName: string) {
  return {
    name: collectionName,
    getFullList: () => `${collectionName}.getFullList()`,
    getOne: (id: string) => `${collectionName}.getOne('${id}')`,
    create: () => `${collectionName}.create()`,
    update: (id: string) => `${collectionName}.update('${id}')`,
    delete: (id: string) => `${collectionName}.delete('${id}')`,
  };
}
