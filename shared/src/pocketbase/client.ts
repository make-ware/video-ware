// Shared PocketBase client configuration
import PocketBase from 'pocketbase';

export interface PocketBaseClientOptions {
  url?: string;
  enableAutoCancellation?: boolean;
  requestTimeout?: number;
}

/**
 * Create a configured PocketBase client with proper settings
 */
export function createPocketBaseClient(
  url: string = 'http://localhost:8090',
  options: Omit<PocketBaseClientOptions, 'url'> = {}
): PocketBase {
  const pb = new PocketBase(url);

  // Enable auto cancellation for duplicate requests
  pb.autoCancellation(options.enableAutoCancellation ?? false);

  // Add global error interceptor for better error handling
  pb.beforeSend = function (url, requestOptions) {
    // Add timeout to prevent hanging requests
    if (!requestOptions.signal && options.requestTimeout) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), options.requestTimeout);
      requestOptions.signal = controller.signal;
    }

    return { url, options: requestOptions };
  };

  return pb;
}

/**
 * Create a default client instance with standard configuration
 */
export function createDefaultClient(
  url?: string,
  options?: Omit<PocketBaseClientOptions, 'url'>
): PocketBase {
  const defaultUrl =
    url ||
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_POCKETBASE_URL
      ? process.env.NEXT_PUBLIC_POCKETBASE_URL
      : 'http://localhost:8090');

  return createPocketBaseClient(defaultUrl, {
    enableAutoCancellation: false,
    requestTimeout: 30000, // 30 second timeout
    ...options,
  });
}

// Legacy exports for backward compatibility
export const pb = createDefaultClient();

export default pb;
