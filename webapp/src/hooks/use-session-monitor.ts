'use client';

import { useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import pb from '@/lib/pocketbase-client';
import { createAuthService } from '@/services';

/**
 * Hook to monitor session validity and handle automatic refresh/expiration
 */
export function useSessionMonitor() {
  const { user, logout } = useAuth();

  // Create auth service instance for this hook
  const authService = useMemo(() => createAuthService(pb), []);

  const checkSessionValidity = useCallback(async () => {
    if (!user) return;

    try {
      // Attempt to refresh the session
      const refreshedUser = await authService.refreshAuth();

      if (!refreshedUser) {
        // Session is invalid, logout user
        console.warn('Session expired, logging out user');
        logout();
      }
    } catch (error) {
      console.error('Session check failed:', error);
      // On error, logout to be safe
      logout();
    }
  }, [user, logout, authService]);

  useEffect(() => {
    if (!user) return;

    // Check session validity every 5 minutes
    const interval = setInterval(checkSessionValidity, 5 * 60 * 1000);

    // Also check on window focus (user returns to tab)
    const handleFocus = () => {
      checkSessionValidity();
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user, checkSessionValidity]);

  // Check session on network reconnection
  useEffect(() => {
    if (!user) return;

    const handleOnline = () => {
      checkSessionValidity();
    };

    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [user, checkSessionValidity]);
}
