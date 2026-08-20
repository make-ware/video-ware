'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { TypedPocketBase } from '@project/shared/types';
import pb, { syncBaseUrl } from '@/lib/pocketbase-client';

interface PocketBaseContextType {
  pb: TypedPocketBase;
}

const PocketBaseContext = createContext<PocketBaseContextType | undefined>(
  undefined
);

export function PocketBaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useMemo(() => {
    // Ordering insurance: reconcile the singleton against the server-injected
    // runtime config before any descendant renders or fires an effect. This
    // provider sits above every consumer, and the call is a no-op when
    // `PUBLIC_POCKETBASE_URL` is unset.
    syncBaseUrl();
    return { pb };
  }, []);
  return (
    <PocketBaseContext.Provider value={value}>
      {children}
    </PocketBaseContext.Provider>
  );
}

export function usePocketBase() {
  const context = useContext(PocketBaseContext);
  if (context === undefined) {
    throw new Error('usePocketBase must be used within a PocketBaseProvider');
  }
  return context;
}
