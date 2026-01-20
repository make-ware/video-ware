'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
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

  // Create auth service - memoized to prevent recreation on every render
  const authService = useMemo(() => createAuthService(pb), []);

  // Initialize auth state from PocketBase AuthStore
  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);

      try {
        // Check if there's a valid auth token
        if (pb.authStore.isValid && pb.authStore.model) {
          // Verify the token is still valid by making a test request
          try {
            await pb.collection('Users').authRefresh();
            setUser(pb.authStore.model as User);
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
    const unsubscribe = pb.authStore.onChange((token, model) => {
      setUser(model as User | null);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Session monitoring - check validity periodically
  useEffect(() => {
    if (!user) return;

    const checkSession = async () => {
      try {
        const refreshedUser = await authService.refreshAuth();
        if (!refreshedUser) {
          console.warn('Session expired during periodic check');
          setUser(null);
        }
      } catch (error) {
        console.error('Session check failed:', error);
        pb.authStore.clear();
        setUser(null);
      }
    };

    // Check session every 5 minutes
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
        const userData = await authService.login(email, password);
        setUser(userData);
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
        const userData = await authService.register({
          email: data.email,
          password: data.password,
          passwordConfirm: data.passwordConfirm,
          name: data.name,
        });
        setUser(userData);
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

      // Clear local state
      setUser(null);

      // Clear loading states
      globalLoadingManager.clear();
    } catch (error) {
      console.error('Logout error:', error);
      const parsedError = parseAuthError(error);
      // Force clear state even if logout fails
      pb.authStore.clear();
      setUser(null);
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
        setUser(updatedUser);
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
        setUser(updatedUser);
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

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user && pb.authStore.isValid,
    login,
    signup,
    logout,
    updateProfile,
    changePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Export the context for use in the hook
export { AuthContext };
