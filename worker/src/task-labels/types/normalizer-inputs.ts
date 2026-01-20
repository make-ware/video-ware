/**
 * Normalizer Input Types
 *
 * Input types for all normalizers that transform GCVI responses into database entities.
 */

import type { ExecutorResponse } from './executor-responses';

/**
 * Generic normalizer input that wraps an executor response with context
 */
export interface NormalizerInput<TResponse extends ExecutorResponse> {
  response: TResponse;
  mediaId: string;
  workspaceRef: string;
  taskRef: string;
  version: number;
  processor: string;
  processorVersion: string;
}

/**
 * Type helper to extract the response type from a normalizer input
 */
export type ExtractResponse<T> = T extends NormalizerInput<infer R> ? R : never;
