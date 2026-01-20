'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import pb from '@/lib/pocketbase-client';
import { useAuth } from '@/hooks/use-auth';
import type { RecordSubscription } from 'pocketbase';
import type { Todo } from '@project/shared';

interface SubscriptionOptions {
  /**
   * Whether to automatically subscribe when the hook mounts
   * @default true
   */
  autoSubscribe?: boolean;

  /**
   * Callback for connection state changes
   */
  onConnectionChange?: (connected: boolean) => void;

  /**
   * Callback for subscription errors
   */
  onError?: (error: Error) => void;

  /**
   * Retry attempts for failed subscriptions
   * @default 3
   */
  maxRetries?: number;

  /**
   * Delay between retry attempts in milliseconds
   * @default 1000
   */
  retryDelay?: number;
}

interface TodoSubscriptionHook {
  /**
   * Whether the subscription is currently active and connected
   */
  isConnected: boolean;

  /**
   * Whether the subscription is in the process of connecting
   */
  isConnecting: boolean;

  /**
   * Current error state, if any
   */
  error: Error | null;

  /**
   * Number of retry attempts made
   */
  retryCount: number;

  /**
   * Manually subscribe to todo updates
   */
  subscribe: () => Promise<void>;

  /**
   * Manually unsubscribe from todo updates
   */
  unsubscribe: () => void;

  /**
   * Retry the subscription after a failure
   */
  retry: () => Promise<void>;

  /**
   * Clear the current error state
   */
  clearError: () => void;
}

/**
 * Custom hook for managing PocketBase real-time subscriptions to todo updates
 *
 * @param userId - The user ID to filter todos for (optional, uses authenticated user by default)
 * @param onUpdate - Callback function called when todo updates are received
 * @param options - Configuration options for the subscription
 * @returns Object with subscription state and control methods
 */
export function useTodoSubscription(
  onUpdate: (data: RecordSubscription<Todo>) => void,
  userId?: string,
  options: SubscriptionOptions = {}
): TodoSubscriptionHook {
  const {
    autoSubscribe = true,
    onConnectionChange,
    onError,
    maxRetries = 3,
    retryDelay = 1000,
  } = options;

  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Refs
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const subscribeRef = useRef<(() => Promise<void>) | null>(null);

  // Auth context
  const { user, isAuthenticated } = useAuth();
  const targetUserId = userId || user?.id;

  // Update callback ref when it changes
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Handle connection state changes
  const handleConnectionChange = useCallback(
    (connected: boolean) => {
      setIsConnected(connected);
      onConnectionChange?.(connected);
    },
    [onConnectionChange]
  );

  // Handle errors
  const handleError = useCallback(
    (err: Error) => {
      console.error('Todo subscription error:', err);
      setError(err);
      setIsConnecting(false);
      handleConnectionChange(false);
      onError?.(err);
    },
    [onError, handleConnectionChange]
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    if (unsubscribeRef.current) {
      try {
        unsubscribeRef.current();
      } catch (err) {
        console.warn('Error during subscription cleanup:', err);
      }
      unsubscribeRef.current = null;
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    setIsConnecting(false);
    handleConnectionChange(false);
  }, [handleConnectionChange]);

  // Subscribe function
  const subscribe = useCallback(async () => {
    // Don't subscribe if not authenticated or already connected
    if (!isAuthenticated || !targetUserId || isConnected || isConnecting) {
      return;
    }

    setIsConnecting(true);
    clearError();

    try {
      // Clean up any existing subscription
      cleanup();

      // Subscribe to all todos collection changes
      // PocketBase access rules will automatically filter to user's todos
      await pb
        .collection('Todos')
        .subscribe('*', (data: RecordSubscription<Todo>) => {
          try {
            // Additional client-side filtering if userId is specified
            if (userId && data.record.user !== userId) {
              return;
            }

            // Call the update callback
            onUpdateRef.current(data);
          } catch (err) {
            console.error('Error processing todo update:', err);
          }
        });

      // Create unsubscribe function
      unsubscribeRef.current = () => {
        pb.collection('Todos').unsubscribe('*');
      };

      setIsConnecting(false);
      setRetryCount(0);
      handleConnectionChange(true);
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error('Subscription failed');
      handleError(error);

      // Retry logic
      if (retryCount < maxRetries) {
        const nextRetryCount = retryCount + 1;
        setRetryCount(nextRetryCount);

        retryTimeoutRef.current = setTimeout(() => {
          console.log(
            `Retrying todo subscription (attempt ${nextRetryCount}/${maxRetries})`
          );
          subscribeRef.current?.();
        }, retryDelay * nextRetryCount); // Exponential backoff
      }
    }
  }, [
    isAuthenticated,
    targetUserId,
    isConnected,
    isConnecting,
    userId,
    retryCount,
    maxRetries,
    retryDelay,
    cleanup,
    clearError,
    handleError,
    handleConnectionChange,
  ]);

  // Store subscribe function in ref for retry logic
  useEffect(() => {
    subscribeRef.current = subscribe;
  }, [subscribe]);

  // Unsubscribe function
  const unsubscribe = useCallback(() => {
    cleanup();
    setRetryCount(0);
    clearError();
  }, [cleanup, clearError]);

  // Retry function
  const retry = useCallback(async () => {
    setRetryCount(0);
    clearError();
    await subscribe();
  }, [subscribe, clearError]);

  // Auto-subscribe effect
  useEffect(() => {
    if (autoSubscribe && isAuthenticated && targetUserId) {
      // Use setTimeout to avoid synchronous setState in effect
      const timeoutId = setTimeout(() => {
        subscribe();
      }, 0);

      return () => {
        clearTimeout(timeoutId);
        cleanup();
      };
    }

    return () => {
      cleanup();
    };
  }, [autoSubscribe, isAuthenticated, targetUserId, subscribe, cleanup]);

  // Handle authentication changes
  useEffect(() => {
    if (!isAuthenticated) {
      // Use setTimeout to avoid synchronous setState in effect
      const timeoutId = setTimeout(() => {
        unsubscribe();
      }, 0);

      return () => {
        clearTimeout(timeoutId);
      };
    }
  }, [isAuthenticated, unsubscribe]);

  // Handle window focus/blur for connection management
  useEffect(() => {
    const handleFocus = () => {
      // Reconnect when window gains focus if we were connected before
      if (isAuthenticated && targetUserId && !isConnected && !error) {
        subscribe();
      }
    };

    const handleBlur = () => {
      // Optionally unsubscribe when window loses focus to save resources
      // Commented out as it might be too aggressive
      // unsubscribe();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isAuthenticated, targetUserId, isConnected, error, subscribe]);

  // Handle online/offline events
  useEffect(() => {
    const handleOnline = () => {
      if (isAuthenticated && targetUserId && !isConnected) {
        subscribe();
      }
    };

    const handleOffline = () => {
      unsubscribe();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isAuthenticated, targetUserId, isConnected, subscribe, unsubscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isConnected,
    isConnecting,
    error,
    retryCount,
    subscribe,
    unsubscribe,
    retry,
    clearError,
  };
}
