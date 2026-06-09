'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

export function QueryProvider({ children }: { children: ReactNode }) {
  // useState factory: one client per browser tab, stable across re-renders,
  // never shared between requests. Also keeps the provider value stable, so
  // it satisfies react/jsx-no-constructed-context-values.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // metadata changes slowly; cut refetch churn
            gcTime: 5 * 60_000, // keep unmounted caches across route hops
            retry: 1, // PB errors are usually deterministic (auth/404)
            refetchOnWindowFocus: false, // focus refetch disrupts playback
            refetchOnReconnect: true,
          },
          mutations: { retry: 0 },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
