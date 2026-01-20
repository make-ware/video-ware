/**
 * Error types and handling utilities for the media uploads and ingestion system
 *
 * This module provides:
 * - UploadError class with code, message, and retryable fields
 * - Error codes for common upload and processing failures
 * - Utility functions for error handling
 *
 * Requirements: 2.3, 2.4, 3.4, 8.1, 8.4
 */

/**
 * Error codes for upload and processing errors
 */
export enum UploadErrorCode {
  // File validation errors (Requirements 2.3, 2.4)
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',

  // Network and transfer errors (Requirement 3.4)
  NETWORK_ERROR = 'NETWORK_ERROR',
  UPLOAD_ABORTED = 'UPLOAD_ABORTED',
  UPLOAD_TIMEOUT = 'UPLOAD_TIMEOUT',

  // Authorization errors
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  WORKSPACE_ACCESS_DENIED = 'WORKSPACE_ACCESS_DENIED',

  // Storage errors
  STORAGE_ERROR = 'STORAGE_ERROR',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',

  // Processing errors (Requirements 8.1, 8.4)
  PROBE_ERROR = 'PROBE_ERROR',
  THUMBNAIL_ERROR = 'THUMBNAIL_ERROR',
  SPRITE_ERROR = 'SPRITE_ERROR',
  TRANSCODE_ERROR = 'TRANSCODE_ERROR',
  PROCESSING_TIMEOUT = 'PROCESSING_TIMEOUT',
  UNKNOWN_CODEC = 'UNKNOWN_CODEC',

  // Task errors
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_ALREADY_RUNNING = 'TASK_ALREADY_RUNNING',
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',

  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

/**
 * User-friendly error messages for each error code
 */
export const ERROR_MESSAGES: Record<UploadErrorCode, string> = {
  [UploadErrorCode.INVALID_FILE_TYPE]:
    'Invalid file type. Please upload MP4, WebM, or QuickTime video.',
  [UploadErrorCode.FILE_TOO_LARGE]: 'File too large. Maximum size is 8GB.',
  [UploadErrorCode.NETWORK_ERROR]:
    'Upload failed due to network error. Please check your connection and try again.',
  [UploadErrorCode.UPLOAD_ABORTED]: 'Upload was cancelled.',
  [UploadErrorCode.UPLOAD_TIMEOUT]: 'Upload timed out. Please try again.',
  [UploadErrorCode.AUTHORIZATION_ERROR]:
    'You are not authorized to perform this action.',
  [UploadErrorCode.WORKSPACE_ACCESS_DENIED]:
    "You don't have permission to upload to this workspace.",
  [UploadErrorCode.STORAGE_ERROR]: 'Storage error. Please try again.',
  [UploadErrorCode.FILE_NOT_FOUND]: 'File not found.',
  [UploadErrorCode.PROBE_ERROR]:
    'Unable to read video file. File may be corrupted.',
  [UploadErrorCode.THUMBNAIL_ERROR]: 'Failed to generate thumbnail.',
  [UploadErrorCode.SPRITE_ERROR]: 'Failed to generate preview.',
  [UploadErrorCode.TRANSCODE_ERROR]: 'Failed to transcode video.',
  [UploadErrorCode.PROCESSING_TIMEOUT]:
    'Processing timed out. Please try again with a smaller file.',
  [UploadErrorCode.UNKNOWN_CODEC]:
    'Unsupported video format. Please convert to MP4, WebM, or QuickTime.',
  [UploadErrorCode.TASK_NOT_FOUND]: 'Task not found.',
  [UploadErrorCode.TASK_ALREADY_RUNNING]: 'Task is already running.',
  [UploadErrorCode.MAX_RETRIES_EXCEEDED]: 'Maximum retry attempts exceeded.',
  [UploadErrorCode.UNKNOWN_ERROR]:
    'An unexpected error occurred. Please try again.',
  [UploadErrorCode.VALIDATION_ERROR]:
    'Validation error. Please check your input.',
};

/**
 * Determines if an error code represents a retryable error
 */
export const RETRYABLE_ERRORS: Set<UploadErrorCode> = new Set([
  UploadErrorCode.NETWORK_ERROR,
  UploadErrorCode.UPLOAD_TIMEOUT,
  UploadErrorCode.STORAGE_ERROR,
  UploadErrorCode.PROBE_ERROR,
  UploadErrorCode.THUMBNAIL_ERROR,
  UploadErrorCode.SPRITE_ERROR,
  UploadErrorCode.TRANSCODE_ERROR,
  UploadErrorCode.PROCESSING_TIMEOUT,
]);

/**
 * Custom error class for upload and processing errors
 *
 * Provides structured error information including:
 * - code: Machine-readable error code
 * - message: User-friendly error message
 * - retryable: Whether the operation can be retried
 * - details: Additional context about the error
 */
export class UploadError extends Error {
  public readonly code: UploadErrorCode;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: UploadErrorCode,
    message?: string,
    details?: Record<string, unknown>
  ) {
    const errorMessage = message || ERROR_MESSAGES[code] || 'Unknown error';
    super(errorMessage);

    this.name = 'UploadError';
    this.code = code;
    this.retryable = RETRYABLE_ERRORS.has(code);
    this.details = details;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UploadError);
    }
  }

  /**
   * Create an UploadError from an unknown error
   */
  static fromError(
    error: unknown,
    defaultCode: UploadErrorCode = UploadErrorCode.UNKNOWN_ERROR
  ): UploadError {
    if (error instanceof UploadError) {
      return error;
    }

    if (error instanceof Error) {
      // Try to detect specific error types from the message
      const message = error.message.toLowerCase();

      if (
        message.includes('network') ||
        message.includes('fetch') ||
        message.includes('connection')
      ) {
        return new UploadError(UploadErrorCode.NETWORK_ERROR, error.message);
      }

      if (message.includes('timeout')) {
        return new UploadError(UploadErrorCode.UPLOAD_TIMEOUT, error.message);
      }

      if (message.includes('abort') || message.includes('cancel')) {
        return new UploadError(UploadErrorCode.UPLOAD_ABORTED, error.message);
      }

      if (
        message.includes('unauthorized') ||
        message.includes('forbidden') ||
        message.includes('permission')
      ) {
        return new UploadError(
          UploadErrorCode.AUTHORIZATION_ERROR,
          error.message
        );
      }

      return new UploadError(defaultCode, error.message);
    }

    return new UploadError(defaultCode, String(error));
  }

  /**
   * Create an invalid file type error
   */
  static invalidFileType(
    actualType: string,
    allowedTypes: string[]
  ): UploadError {
    return new UploadError(
      UploadErrorCode.INVALID_FILE_TYPE,
      `Invalid file type: ${actualType}. Allowed types: ${allowedTypes.join(', ')}`,
      { actualType, allowedTypes }
    );
  }

  /**
   * Create a file too large error
   */
  static fileTooLarge(actualSize: number, maxSize: number): UploadError {
    const actualSizeGB = (actualSize / (1024 * 1024 * 1024)).toFixed(2);
    const maxSizeGB = (maxSize / (1024 * 1024 * 1024)).toFixed(2);
    return new UploadError(
      UploadErrorCode.FILE_TOO_LARGE,
      `File too large: ${actualSizeGB}GB. Maximum allowed size: ${maxSizeGB}GB`,
      { actualSize, maxSize, actualSizeGB, maxSizeGB }
    );
  }

  /**
   * Create a network error
   */
  static networkError(originalError?: Error): UploadError {
    return new UploadError(
      UploadErrorCode.NETWORK_ERROR,
      originalError?.message || ERROR_MESSAGES[UploadErrorCode.NETWORK_ERROR],
      originalError ? { originalError: originalError.message } : undefined
    );
  }

  /**
   * Create a processing error
   */
  static processingError(
    step: 'probe' | 'thumbnail' | 'sprite' | 'transcode',
    originalError?: Error
  ): UploadError {
    const codeMap: Record<string, UploadErrorCode> = {
      probe: UploadErrorCode.PROBE_ERROR,
      thumbnail: UploadErrorCode.THUMBNAIL_ERROR,
      sprite: UploadErrorCode.SPRITE_ERROR,
      transcode: UploadErrorCode.TRANSCODE_ERROR,
    };

    const code = codeMap[step] || UploadErrorCode.UNKNOWN_ERROR;
    return new UploadError(
      code,
      originalError?.message || ERROR_MESSAGES[code],
      { step, originalError: originalError?.message }
    );
  }

  /**
   * Create a max retries exceeded error
   */
  static maxRetriesExceeded(
    attempts: number,
    maxAttempts: number
  ): UploadError {
    return new UploadError(
      UploadErrorCode.MAX_RETRIES_EXCEEDED,
      `Maximum retry attempts exceeded (${attempts}/${maxAttempts})`,
      { attempts, maxAttempts }
    );
  }

  /**
   * Convert to a plain object for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/**
 * Task error log structure for detailed error tracking
 */
export interface TaskErrorLog {
  timestamp: string;
  step:
    | 'probe'
    | 'thumbnail'
    | 'sprite'
    | 'transcode'
    | 'media_create'
    | 'clip_create'
    | 'unknown';
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Create a task error log entry
 */
export function createTaskErrorLog(
  step: TaskErrorLog['step'],
  error: unknown,
  context?: Record<string, unknown>
): TaskErrorLog {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  return {
    timestamp: new Date().toISOString(),
    step,
    error: errorMessage,
    stack: errorStack,
    context,
  };
}

/**
 * Format a task error log for storage
 */
export function formatTaskErrorLog(log: TaskErrorLog): string {
  const parts = [`[${log.timestamp}] Step: ${log.step}`, `Error: ${log.error}`];

  if (log.context) {
    parts.push(`Context: ${JSON.stringify(log.context)}`);
  }

  if (log.stack) {
    parts.push(`Stack: ${log.stack}`);
  }

  return parts.join('\n');
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof UploadError) {
    return error.retryable;
  }

  // For generic errors, check the message for common retryable patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('temporary') ||
      message.includes('retry')
    );
  }

  return false;
}
