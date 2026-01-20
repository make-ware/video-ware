/**
 * Comprehensive error handling utilities for authentication operations
 */

/**
 * PocketBase error response structure
 */
interface PocketBaseErrorData {
  data?: Record<string, { code?: string; message?: string }>;
  message?: string;
}

/**
 * PocketBase ClientResponseError-like structure
 */
interface PocketBaseError {
  status?: number;
  data?: PocketBaseErrorData;
  message?: string;
  name?: string;
}

/**
 * Type guard to check if error has status property
 */
function hasStatus(
  error: unknown
): error is PocketBaseError & { status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  );
}

/**
 * Type guard to check if error has message property
 */
function hasMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

/**
 * Type guard to check if error has name property
 */
function hasName(error: unknown): error is { name: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof (error as { name: unknown }).name === 'string'
  );
}

/**
 * Type guard to check if error has data property
 */
function hasData(error: unknown): error is PocketBaseError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof (error as { data: unknown }).data === 'object'
  );
}

/**
 * Union type representing all possible error types
 */
type ErrorType = Error | PocketBaseError | string | unknown;

export interface AuthError {
  type:
    | 'validation'
    | 'authentication'
    | 'network'
    | 'authorization'
    | 'server'
    | 'unknown';
  message: string;
  field?: string;
  code?: string;
  originalError?: ErrorType;
}

/**
 * Parse and categorize errors from PocketBase operations
 */
export function parseAuthError(error: ErrorType): AuthError {
  // Handle network errors with name check
  if (
    hasName(error) &&
    error.name === 'TypeError' &&
    hasMessage(error) &&
    error.message.includes('fetch')
  ) {
    return {
      type: 'network',
      message:
        'Network error. Please check your internet connection and try again.',
      originalError: error,
    };
  }

  // Handle network errors by message content
  if (hasMessage(error)) {
    const message = error.message;
    if (
      message.includes('NetworkError') ||
      message.includes('Failed to fetch') ||
      message.includes('fetch failed') ||
      message.includes('Network request failed')
    ) {
      return {
        type: 'network',
        message:
          'Unable to connect to the server. Please check your internet connection.',
        originalError: error,
      };
    }
  }

  // Handle PocketBase specific errors
  // Status 0 typically indicates network errors (CORS, connection refused, etc.)
  if (hasStatus(error) && error.status === 0) {
    return {
      type: 'network',
      message:
        'Network error. Please check your internet connection and try again.',
      originalError: error,
    };
  }

  if (hasStatus(error)) {
    switch (error.status) {
      case 400:
        // Validation errors
        if (hasData(error) && error.data?.data) {
          const fieldErrors = error.data.data;
          const fieldNames = Object.keys(fieldErrors);

          // Check if this is an authentication-related error (password or identity fields)
          const isAuthError = fieldNames.some((field) => {
            const fieldLower = field.toLowerCase();
            return (
              field === 'password' ||
              field === 'identity' ||
              field === 'identity.email' ||
              fieldLower.includes('password') ||
              fieldLower.includes('identity')
            );
          });

          // Check for authentication-related error codes or messages
          const firstField = fieldNames[0];
          const firstError = fieldErrors[firstField];
          const errorCode = firstError?.code;
          const errorMessage = firstError?.message?.toLowerCase() || '';

          const isAuthFailure =
            isAuthError ||
            errorCode === 'validation_invalid_credentials' ||
            (errorMessage.includes('invalid') &&
              (errorMessage.includes('password') ||
                errorMessage.includes('credentials'))) ||
            errorMessage.includes('failed to authenticate') ||
            errorMessage.includes('authentication failed');

          if (isAuthFailure) {
            return {
              type: 'authentication',
              message:
                'Invalid credentials. Please check your email and password.',
              field: firstField,
              code: errorCode,
              originalError: error,
            };
          }

          return {
            type: 'validation',
            message: firstError?.message || 'Invalid input data.',
            field: firstField,
            code: firstError?.code,
            originalError: error,
          };
        }

        if (hasData(error) && error.data?.message) {
          const dataMessage = error.data.message;
          if (
            dataMessage.includes('Failed to authenticate') ||
            dataMessage.toLowerCase().includes('invalid credentials') ||
            dataMessage.toLowerCase().includes('authentication failed')
          ) {
            return {
              type: 'authentication',
              message:
                'Invalid credentials. Please check your email and password.',
              originalError: error,
            };
          }

          if (dataMessage.includes('email')) {
            return {
              type: 'validation',
              message: 'This email address is already registered.',
              field: 'email',
              originalError: error,
            };
          }

          return {
            type: 'validation',
            message: dataMessage || 'Invalid request data.',
            originalError: error,
          };
        }

        return {
          type: 'validation',
          message: 'Invalid request data.',
          originalError: error,
        };

      case 401:
        return {
          type: 'authentication',
          message: 'Invalid credentials. Please check your email and password.',
          originalError: error,
        };

      case 403:
        return {
          type: 'authorization',
          message: 'You do not have permission to perform this action.',
          originalError: error,
        };

      case 404:
        return {
          type: 'authentication',
          message: 'Account not found. Please check your email address.',
          originalError: error,
        };

      case 429:
        return {
          type: 'server',
          message: 'Too many requests. Please wait a moment and try again.',
          originalError: error,
        };

      case 500:
      case 502:
      case 503:
      case 504:
        return {
          type: 'server',
          message: 'Server error. Please try again later.',
          originalError: error,
        };

      default: {
        const defaultMessage =
          hasData(error) && error.data?.message
            ? error.data.message
            : 'An unexpected error occurred.';
        return {
          type: 'unknown',
          message: defaultMessage,
          originalError: error,
        };
      }
    }
  }

  // Handle generic JavaScript errors
  if (error instanceof Error) {
    const errorMsg = error.message.toLowerCase();
    if (
      errorMsg.includes('failed to authenticate') ||
      errorMsg.includes('invalid credentials') ||
      errorMsg.includes('authentication failed') ||
      (errorMsg.includes('invalid') &&
        (errorMsg.includes('password') || errorMsg.includes('email')))
    ) {
      return {
        type: 'authentication',
        message: 'Invalid credentials. Please check your email and password.',
        originalError: error,
      };
    }

    if (
      error.message.includes('network') ||
      error.message.includes('offline') ||
      error.message.includes('fetch failed') ||
      error.message.includes('Failed to fetch')
    ) {
      return {
        type: 'network',
        message: 'Network error. Please check your connection and try again.',
        originalError: error,
      };
    }

    return {
      type: 'unknown',
      message: error.message || 'An unexpected error occurred.',
      originalError: error,
    };
  }

  // Fallback for unknown error types
  return {
    type: 'unknown',
    message:
      typeof error === 'string' ? error : 'An unexpected error occurred.',
    originalError: error,
  };
}

/**
 * Get user-friendly error message for display
 */
export function getErrorMessage(error: ErrorType): string {
  const parsedError = parseAuthError(error);
  return parsedError.message;
}

/**
 * Get field-specific error message for form validation
 */
export function getFieldError(
  error: ErrorType,
  fieldName: string
): string | undefined {
  const parsedError = parseAuthError(error);

  if (parsedError.type === 'validation' && parsedError.field === fieldName) {
    return parsedError.message;
  }

  // Handle specific field mappings
  if (parsedError.type === 'authentication') {
    if (fieldName === 'email' || fieldName === 'password') {
      return 'Invalid email or password.';
    }
  }

  return undefined;
}

/**
 * Check if auth error is retryable (network or server errors)
 */
export function isAuthRetryableError(error: ErrorType): boolean {
  const parsedError = parseAuthError(error);
  return parsedError.type === 'network' || parsedError.type === 'server';
}

/**
 * Get appropriate toast message based on error type
 */
export function getToastMessage(
  error: ErrorType,
  operation: string
): { title: string; description?: string } {
  const parsedError = parseAuthError(error);

  switch (parsedError.type) {
    case 'network':
      return {
        title: `${operation} failed`,
        description: 'Please check your internet connection and try again.',
      };

    case 'authentication':
      return {
        title: `${operation} failed`,
        description: 'Please check your credentials and try again.',
      };

    case 'validation':
      return {
        title: `${operation} failed`,
        description: 'Please check your input and try again.',
      };

    case 'server':
      return {
        title: `${operation} failed`,
        description: 'Server error. Please try again later.',
      };

    default:
      return {
        title: `${operation} failed`,
        description: parsedError.message,
      };
  }
}

/**
 * Retry mechanism for network operations
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: ErrorType | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as ErrorType;

      // Only retry for network or server errors
      if (!isAuthRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      // Wait before retrying with exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, delay * Math.pow(2, attempt - 1))
      );
    }
  }

  throw lastError ?? new Error('Retry failed with unknown error');
}

/**
 * Loading state manager for async operations
 */
export class LoadingManager {
  private loadingStates = new Map<string, boolean>();
  private listeners = new Set<(states: Record<string, boolean>) => void>();

  setLoading(key: string, loading: boolean) {
    this.loadingStates.set(key, loading);
    this.notifyListeners();
  }

  isLoading(key: string): boolean {
    return this.loadingStates.get(key) || false;
  }

  isAnyLoading(): boolean {
    return Array.from(this.loadingStates.values()).some((loading) => loading);
  }

  subscribe(listener: (states: Record<string, boolean>) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const states = Object.fromEntries(this.loadingStates);
    this.listeners.forEach((listener) => listener(states));
  }

  clear() {
    this.loadingStates.clear();
    this.notifyListeners();
  }
}

// Global loading manager instance
export const globalLoadingManager = new LoadingManager();
