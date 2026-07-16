import { useEffect, useSyncExternalStore } from 'react';
import {
  usePageMenuStore,
  EMPTY_PAGE_MENUS,
  type PageMenuId,
  type PageMenuItem,
  type PageMenuSnapshot,
} from '@/contexts/page-menu-context';

const getServerSnapshot = (): PageMenuSnapshot => EMPTY_PAGE_MENUS;

/**
 * Read the current page-provided File/Edit menu items. Used by the nav bar.
 * Must be used within a PageMenuProvider.
 */
export function usePageMenus(): PageMenuSnapshot {
  const store = usePageMenuStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerSnapshot
  );
}

/**
 * Register a page's items into a nav-bar menu (`file` or `edit`) for as long as
 * the calling component is mounted; the items are cleared on unmount.
 *
 * Pass a memoized `items` array (and memoized `onSelect` handlers) so the
 * effect only re-runs when the menu contents actually change.
 *
 * Must be used within a PageMenuProvider.
 */
export function useRegisterPageMenu(
  id: PageMenuId,
  items: PageMenuItem[]
): void {
  const store = usePageMenuStore();

  useEffect(() => {
    store.setMenu(id, items);
    return () => {
      store.clearMenu(id);
    };
  }, [store, id, items]);
}
