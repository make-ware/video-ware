/**
 * Retry utilities with exponential backoff for task processing
 *
 * This module provides:
 * - Exponential backoff calculation
 * - Retry configuration
 * - Retry decision logic
 *
 * Requirements: 8.3, 9.4
 */

import { isMediaRetryableError } from './media-errors.js';

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (including initial attempt) */
  maxAttempts: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (cap for exponential growth) */
  maxDelayMs: number;
  /** Jitter factor (0-1) to add randomness to delays */
  jitterFactor: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000, // 1 second
  maxDelayMs: 60000, // 1 minute
  jitterFactor: 0.1, // 10% jitter
};

/**
 * Calculate exponential backoff delay with optional jitter
 *
 * Formula: min(maxDelay, baseDelay * 2^attempt) * (1 + random * jitter)
 *
 * @param attempt Current attempt number (0-indexed)
 * @param config Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Calculate base exponential delay
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter to prevent thundering herd
  const jitter =
    1 + (Math.random() * config.jitterFactor * 2 - config.jitterFactor);

  return Math.floor(cappedDelay * jitter);
}

/**
 * Result of a retry decision
 */
export interface RetryDecision {
  /** Whether to retry the operation */
  shouldRetry: boolean;
  /** Delay before retrying (in milliseconds) */
  delayMs: number;
  /** Reason for the decision */
  reason: string;
}

/**
 * Determine whether to retry a failed operation
 *
 * @param error The error that occurred
 * @param currentAttempts Number of attempts made so far
 * @param config Retry configuration
 * @returns Retry decision with delay and reason
 */
export function shouldRetry(
  error: unknown,
  currentAttempts: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): RetryDecision {
  // Check if we've exceeded max attempts
  if (currentAttempts >= config.maxAttempts) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: `Maximum attempts exceeded (${currentAttempts}/${config.maxAttempts})`,
    };
  }

  // Check if the error is retryable
  if (!isMediaRetryableError(error)) {
    return {
      shouldRetry: false,
      delayMs: 0,
      reason: 'Error is not retryable',
    };
  }

  // Calculate delay for next attempt
  const delayMs = calculateBackoffDelay(currentAttempts, config);

  return {
    shouldRetry: true,
    delayMs,
    reason: `Retrying after ${delayMs}ms (attempt ${currentAttempts + 1}/${config.maxAttempts})`,
  };
}

/**
 * Sleep for a specified duration
 *
 * @param ms Duration in milliseconds
 * @returns Promise that resolves after the duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
