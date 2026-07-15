'use client';

import React, { createContext, useContext, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export type PageMenuId = 'file' | 'edit';

export interface PageMenuItem {
  /** Stable id, unique within its menu (used as the React key). */
  id: string;
  label: string;
  /** Optional leading icon (lucide-react component). */
  icon?: LucideIcon;
  disabled?: boolean;
  /** Render a separator above this item, for visual grouping. */
  separatorBefore?: boolean;
  onSelect: () => void;
}

export type PageMenuSnapshot = Record<PageMenuId, PageMenuItem[]>;

/**
 * Shared, referentially-stable empty snapshot. Used as the server snapshot and
 * the store's initial value so SSR and the first client render agree.
 */
export const EMPTY_PAGE_MENUS: PageMenuSnapshot = {
  file: [],
  edit: [],
};

export interface PageMenuStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PageMenuSnapshot;
  setMenu: (id: PageMenuId, items: PageMenuItem[]) => void;
  clearMenu: (id: PageMenuId) => void;
}

/**
 * External store backing the File/Edit menus. Pages write into it from an
 * effect (a plain method call, not a React setState) and the nav bar reads it
 * via `useSyncExternalStore`. `getSnapshot` returns the same reference between
 * mutations, and each mutation replaces the top-level snapshot immutably.
 */
function createPageMenuStore(): PageMenuStore {
  let snapshot: PageMenuSnapshot = EMPTY_PAGE_MENUS;
  const listeners = new Set<() => void>();

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    setMenu(id, items) {
      if (snapshot[id] === items) return;
      snapshot = { ...snapshot, [id]: items };
      emit();
    },
    clearMenu(id) {
      if (snapshot[id].length === 0) return;
      snapshot = { ...snapshot, [id]: [] };
      emit();
    },
  };
}

const PageMenuContext = createContext<PageMenuStore | undefined>(undefined);

interface PageMenuProviderProps {
  children: React.ReactNode;
}

export function PageMenuProvider({ children }: PageMenuProviderProps) {
  // Create the store exactly once for the lifetime of the provider.
  const [store] = useState(createPageMenuStore);

  return (
    <PageMenuContext.Provider value={store}>
      {children}
    </PageMenuContext.Provider>
  );
}

export function usePageMenuStore(): PageMenuStore {
  const store = useContext(PageMenuContext);

  if (store === undefined) {
    throw new Error('usePageMenuStore must be used within a PageMenuProvider');
  }

  return store;
}
