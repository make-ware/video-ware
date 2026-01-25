'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { User, UserInput } from '@project/shared';
import { parseAuthError, globalLoadingManager } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { createAuthService } from '@/services';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: UserInput) => Promise<void>;
  logout: () => void;
  updateProfile: (data: Partial<UserInput>) => Promise<void>;
  changePassword: (
    oldPassword: string,
    password: string,
    passwordConfirm: string
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Track last check time to prevent spamming refresh on focus
  const lastCheckTime = useRef<number>(0);

  // Create auth service - memoized to prevent recreation on every render
  const authService = useMemo(() => createAuthService(pb), []);

  // Initialize auth state from PocketBase AuthStore
  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);

      try {
        // Check if there's a valid auth token
        // usage of .record instead of .model for consistency with newer PB SDKs
        if (pb.authStore.isValid && pb.authStore.record) {
          // Verify the token is still valid by making a test request
          try {
            await pb.collection('Users').authRefresh();
            // We don't set user here because authRefresh updates the store,
            // which triggers the onChange listener below
          } catch {
            // Token is expired or invalid, clear it
            console.warn('Session expired, clearing auth store');
            pb.authStore.clear();
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        // Clear potentially corrupted auth state
        pb.authStore.clear();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // Listen for auth store changes
    const unsubscribe = pb.authStore.onChange(
      (token: string, record: unknown) => {
        // Use functional state update to access current user without adding it to dependency array
        setUser((currentUser: User | null) => {
          const nextUser = record as User | null;

          // If both are null, no change
          if (!currentUser && !nextUser) return null;

          // If one is null and other is not, change
          if (!currentUser || !nextUser) return nextUser;

          // If IDs are different, change
          if (currentUser.id !== nextUser.id) return nextUser;

          // If updated timestamp is different, change
          // Note: PocketBase 'updated' is a string
          if (currentUser.updated !== nextUser.updated) return nextUser;

          // Otherwise, return current user to prevent re-render
          // This is crucial for stability: authRefresh returns a new object even if data is same
          return currentUser;
        });
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Session monitoring - check validity periodically
  useEffect(() => {
    // Only monitor if we have a user
    if (!user) return;

    const checkSession = async () => {
      const now = Date.now();
      // Throttle checks to once every 2 minutes (120000ms)
      // This prevents rapid re-checks when switching tabs frequently
      if (now - lastCheckTime.current < 120000) {
        return;
      }

      lastCheckTime.current = now;

      try {
        // checking the session will trigger authRefresh which triggers onChange
        const refreshedUser = await authService.refreshAuth();
        if (!refreshedUser) {
          console.warn('Session expired during periodic check');
          // No need to setUser(null) here as refreshAuth clears store on error, triggering onChange
        }
      } catch (error) {
        console.error('Session check failed:', error);
        pb.authStore.clear();
        // onChange will handle state update
      }
    };

    // Check session every 5 minutes (still useful for long background sessions)
    const interval = setInterval(checkSession, 5 * 60 * 1000);

    // Check on window focus
    const handleFocus = () => checkSession();
    window.addEventListener('focus', handleFocus);

    // Check on network reconnection
    const handleOnline = () => checkSession();
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [user, authService]);

  const login = useCallback(
    async (email: string, password: string) => {
      globalLoadingManager.setLoading('auth', true);
      setIsLoading(true);
      try {
        await authService.login(email, password);
        // onChange will handle state update
      } catch (error) {
        console.error('Login error:', error);
        const parsedError = parseAuthError(error);
        throw new Error(parsedError.message);
      } finally {
        globalLoadingManager.setLoading('auth', false);
        setIsLoading(false);
      }
    },
    [authService]
  );

  const signup = useCallback(
    async (data: UserInput) => {
      globalLoadingManager.setLoading('auth', true);
      setIsLoading(true);
      try {
        await authService.register({
          email: data.email,
          password: data.password,
          passwordConfirm: data.passwordConfirm,
          name: data.name,
        });
        // onChange will handle state update
      } catch (error) {
        console.error('Signup error:', error);
        const parsedError = parseAuthError(error);
        throw new Error(parsedError.message);
      } finally {
        globalLoadingManager.setLoading('auth', false);
        setIsLoading(false);
      }
    },
    [authService]
  );

  const logout = useCallback(() => {
    try {
      // Clear PocketBase auth store (this also clears localStorage)
      authService.logout();

      // Clear loading states
      globalLoadingManager.clear();

      // onChange will handle state update to null
    } catch (error) {
      console.error('Logout error:', error);
      const parsedError = parseAuthError(error);
      // Force clear state even if logout fails
      pb.authStore.clear();
      globalLoadingManager.clear();
      throw new Error(parsedError.message);
    }
  }, [authService]);

  const updateProfile = useCallback(
    async (data: Partial<UserInput>) => {
      if (!user) throw new Error('No authenticated user');

      globalLoadingManager.setLoading('profile', true);
      setIsLoading(true);
      try {
        const updatedUser = await authService.updateProfile(user.id, data);
        // Explicitly update auth store to trigger onChange and keep store in sync
        pb.authStore.save(pb.authStore.token, updatedUser);
      } catch (error) {
        console.error('Update profile error:', error);
        const parsedError = parseAuthError(error);
        throw new Error(parsedError.message);
      } finally {
        globalLoadingManager.setLoading('profile', false);
        setIsLoading(false);
      }
    },
    [user, authService]
  );

  const changePassword = useCallback(
    async (oldPassword: string, password: string, passwordConfirm: string) => {
      if (!user) throw new Error('No authenticated user');

      globalLoadingManager.setLoading('password', true);
      setIsLoading(true);
      try {
        const updatedUser = await authService.changePassword(
          user.id,
          oldPassword,
          password,
          passwordConfirm
        );
        // Explicitly update auth store to trigger onChange and keep store in sync
        pb.authStore.save(pb.authStore.token, updatedUser);
      } catch (error) {
        console.error('Change password error:', error);
        const parsedError = parseAuthError(error);
        throw new Error(parsedError.message);
      } finally {
        globalLoadingManager.setLoading('password', false);
        setIsLoading(false);
      }
    },
    [user, authService]
  );

  // Memoize the value to prevent unnecessary re-renders in consumers
  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user && pb.authStore.isValid,
      login,
      signup,
      logout,
      updateProfile,
      changePassword,
    }),
    [
      user,
      isLoading,
      login,
      signup,
      logout,
      updateProfile,
      changePassword,
      // pb.authStore.isValid is mutable, but usually changes with user.
      // If we strictly wanted to react to token changes without user changes, we'd need another state.
      // But for this app, user presence is the main auth indicator.
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Export the context for use in the hook
export { AuthContext };
