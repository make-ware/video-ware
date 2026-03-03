'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

type ClickAction = 'toggle' | 'range' | 'single';

interface UseMultiSelectOptions {
  /** Ordered list of all selectable item IDs */
  items: string[];
  /** Enable keyboard shortcuts (Cmd+A, Escape) — default true */
  enableKeyboard?: boolean;
}

interface UseMultiSelectReturn {
  selectedIds: Set<string>;
  handleClick: (id: string, event: React.MouseEvent) => ClickAction;
  selectAll: () => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
  selectionCount: number;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useMultiSelect({
  items,
  enableKeyboard = true,
}: UseMultiSelectOptions): UseMultiSelectReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items));
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }, []);

  const handleClick = useCallback(
    (id: string, event: React.MouseEvent): ClickAction => {
      const isMetaKey = event.metaKey || event.ctrlKey;
      const isShiftKey = event.shiftKey;

      if (isMetaKey) {
        // Cmd/Ctrl+Click: toggle individual item
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        lastSelectedIdRef.current = id;
        return 'toggle';
      }

      if (isShiftKey && lastSelectedIdRef.current) {
        // Shift+Click: range select
        const lastIndex = items.indexOf(lastSelectedIdRef.current);
        const currentIndex = items.indexOf(id);

        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const rangeItems = items.slice(start, end + 1);

          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const item of rangeItems) {
              next.add(item);
            }
            return next;
          });
          return 'range';
        }
      }

      // Plain click: signal caller to decide behavior
      lastSelectedIdRef.current = id;
      return 'single';
    },
    [items]
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (!enableKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+A: select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        // Only handle if no input/textarea is focused
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        selectAll();
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboard, selectAll, clearSelection]);

  return {
    selectedIds,
    handleClick,
    selectAll,
    clearSelection,
    isSelected,
    selectionCount: selectedIds.size,
    setSelectedIds,
  };
}
