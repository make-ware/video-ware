import { useState, useEffect } from 'react';
import { globalLoadingManager } from '@project/shared';

/**
 * Hook to track global loading states
 */
export function useGlobalLoading() {
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    const unsubscribe = globalLoadingManager.subscribe(setLoadingStates);
    return () => {
      unsubscribe();
    };
  }, []);

  return {
    loadingStates,
    isLoading: (key: string) => loadingStates[key] || false,
    isAnyLoading: () => Object.values(loadingStates).some((loading) => loading),
  };
}

/**
 * Hook for managing local loading state with automatic cleanup
 */
export function useLoadingState(initialState = false) {
  const [isLoading, setIsLoading] = useState(initialState);
  const [error, setError] = useState<string | null>(null);

  const startLoading = () => {
    setIsLoading(true);
    setError(null);
  };

  const stopLoading = () => {
    setIsLoading(false);
  };

  const setLoadingError = (errorMessage: string) => {
    setError(errorMessage);
    setIsLoading(false);
  };

  const reset = () => {
    setIsLoading(false);
    setError(null);
  };

  return {
    isLoading,
    error,
    startLoading,
    stopLoading,
    setLoadingError,
    reset,
  };
}
