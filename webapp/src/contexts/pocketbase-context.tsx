'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { TypedPocketBase } from '@project/shared/types';
import pb from '@/lib/pocketbase-client';

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
  const value = useMemo(() => ({ pb }), []);
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
