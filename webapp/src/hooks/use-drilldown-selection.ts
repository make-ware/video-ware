'use client';

import { useCallback, useState } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

export interface DrilldownSelection<T> {
  /** The item the detail pane should render, or null for none. */
  selected: T | null;
  /** Pick an item (a phone drills down into it). */
  select: (id: string) => void;
  /** Phone: back out of the detail pane to the list. */
  clear: () => void;
  /** Render the master list? Always true on md+. */
  showList: boolean;
  /** Render the detail pane? Always true on md+. */
  showDetail: boolean;
}

/**
 * Selection for a master–detail panel that sits side by side on md+ and drills
 * down on phones.
 *
 * Desktop previews the first item so the detail pane is never blank; a phone
 * shows the list until a row is picked. `showList`/`showDetail` are meant to
 * gate *mounting*, not `hidden` classes: the entity panes run filmstrip
 * animations and fetch sprite sheets, which would otherwise keep running
 * behind the list on the one device where that costs the most.
 */
export function useDrilldownSelection<T>(
  items: T[],
  idOf: (item: T) => string
): DrilldownSelection<T> {
  const isMobile = useIsMobile();
  const [openId, setOpenId] = useState<string>();

  const clear = useCallback(() => setOpenId(undefined), []);

  // A picked item that no longer exists (its labels were unlinked, or the tab
  // changed the underlying list) falls back to the list on a phone and to the
  // first item on desktop, rather than to an empty pane.
  const picked = items.find((item) => idOf(item) === openId) ?? null;
  const selected = isMobile ? picked : (picked ?? items[0] ?? null);

  return {
    selected,
    select: setOpenId,
    clear,
    showList: !isMobile || !picked,
    showDetail: !isMobile || !!picked,
  };
}
