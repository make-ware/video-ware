import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiSelect } from '../use-multi-select';

const ITEMS = ['a', 'b', 'c', 'd', 'e'];

function mouseEvent(
  overrides: Partial<React.MouseEvent> = {}
): React.MouseEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...overrides,
  } as React.MouseEvent;
}

describe('useMultiSelect', () => {
  // ---------------------------------------------------------------------------
  // Selection basics
  // ---------------------------------------------------------------------------
  describe('selection basics', () => {
    it('starts with empty selection and selectionCount 0', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      expect(result.current.selectedIds.size).toBe(0);
      expect(result.current.selectionCount).toBe(0);
    });

    it('selectAll selects every item', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      act(() => result.current.selectAll());
      expect(result.current.selectionCount).toBe(5);
      for (const id of ITEMS) {
        expect(result.current.isSelected(id)).toBe(true);
      }
    });

    it('clearSelection empties the selection', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      act(() => result.current.selectAll());
      act(() => result.current.clearSelection());
      expect(result.current.selectionCount).toBe(0);
    });

    it('isSelected returns correct boolean', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      act(() => {
        result.current.handleClick('b', mouseEvent({ metaKey: true }));
      });
      expect(result.current.isSelected('b')).toBe(true);
      expect(result.current.isSelected('a')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // handleClick behaviour
  // ---------------------------------------------------------------------------
  describe('handleClick', () => {
    it('Cmd+Click toggles item into selection', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      const action = act(() =>
        result.current.handleClick('a', mouseEvent({ metaKey: true }))
      );
      expect(result.current.isSelected('a')).toBe(true);
    });

    it('Cmd+Click on selected item removes it', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      act(() => {
        result.current.handleClick('a', mouseEvent({ metaKey: true }));
      });
      expect(result.current.isSelected('a')).toBe(true);
      act(() => {
        result.current.handleClick('a', mouseEvent({ metaKey: true }));
      });
      expect(result.current.isSelected('a')).toBe(false);
    });

    it('Cmd+Click on unselected item adds it', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      act(() => {
        result.current.handleClick('c', mouseEvent({ metaKey: true }));
      });
      act(() => {
        result.current.handleClick('a', mouseEvent({ metaKey: true }));
      });
      expect(result.current.isSelected('a')).toBe(true);
      expect(result.current.isSelected('c')).toBe(true);
      expect(result.current.selectionCount).toBe(2);
    });

    it('Ctrl+Click toggles (same as metaKey)', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      const action = act(() =>
        result.current.handleClick('d', mouseEvent({ ctrlKey: true }))
      );
      expect(result.current.isSelected('d')).toBe(true);
    });

    it('Shift+Click range-selects forward', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      // First click to set lastSelectedId
      act(() => {
        result.current.handleClick('b', mouseEvent({ metaKey: true }));
      });
      // Shift+Click forward
      act(() => {
        result.current.handleClick('d', mouseEvent({ shiftKey: true }));
      });
      expect(result.current.isSelected('b')).toBe(true);
      expect(result.current.isSelected('c')).toBe(true);
      expect(result.current.isSelected('d')).toBe(true);
    });

    it('Shift+Click range-selects in reverse direction', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      // Click at d
      act(() => {
        result.current.handleClick('d', mouseEvent({ metaKey: true }));
      });
      // Shift+Click backwards to b
      act(() => {
        result.current.handleClick('b', mouseEvent({ shiftKey: true }));
      });
      expect(result.current.isSelected('b')).toBe(true);
      expect(result.current.isSelected('c')).toBe(true);
      expect(result.current.isSelected('d')).toBe(true);
    });

    it('plain click returns "single" action type', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      let action: string | undefined;
      act(() => {
        action = result.current.handleClick('a', mouseEvent());
      });
      expect(action).toBe('single');
    });

    it('Cmd+Click returns "toggle" action type', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      let action: string | undefined;
      act(() => {
        action = result.current.handleClick('a', mouseEvent({ metaKey: true }));
      });
      expect(action).toBe('toggle');
    });

    it('Shift+Click returns "range" action type', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      // Set anchor first
      act(() => {
        result.current.handleClick('a', mouseEvent({ metaKey: true }));
      });
      let action: string | undefined;
      act(() => {
        action = result.current.handleClick(
          'c',
          mouseEvent({ shiftKey: true })
        );
      });
      expect(action).toBe('range');
    });
  });

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  describe('keyboard shortcuts', () => {
    it('Cmd+A selects all items', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'a', metaKey: true })
        );
      });
      expect(result.current.selectionCount).toBe(5);
    });

    it('Escape clears selection', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      act(() => result.current.selectAll());
      expect(result.current.selectionCount).toBe(5);
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(result.current.selectionCount).toBe(0);
    });

    it('Cmd+A skips when focus is in INPUT element', () => {
      const { result } = renderHook(() => useMultiSelect({ items: ITEMS }));
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      act(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'a',
            metaKey: true,
            bubbles: true,
          })
        );
      });
      expect(result.current.selectionCount).toBe(0);
      document.body.removeChild(input);
    });

    it('enableKeyboard: false disables keyboard listeners', () => {
      const { result } = renderHook(() =>
        useMultiSelect({ items: ITEMS, enableKeyboard: false })
      );
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'a', metaKey: true })
        );
      });
      expect(result.current.selectionCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('automatically prunes stale IDs when items change', () => {
      const { result, rerender } = renderHook(
        ({ items }) => useMultiSelect({ items }),
        { initialProps: { items: ITEMS } }
      );
      act(() => result.current.selectAll());
      expect(result.current.selectionCount).toBe(5);

      // Simulate items list shrinking (e.g. directory change)
      rerender({ items: ['a', 'c'] });
      expect(result.current.selectionCount).toBe(2);
      expect(result.current.isSelected('a')).toBe(true);
      expect(result.current.isSelected('c')).toBe(true);
      expect(result.current.isSelected('b')).toBe(false);
    });

    it('clears selection entirely when navigating to a new directory', () => {
      const { result, rerender } = renderHook(
        ({ items }) => useMultiSelect({ items }),
        { initialProps: { items: ['a', 'b', 'c'] } }
      );
      act(() => result.current.selectAll());
      expect(result.current.selectionCount).toBe(3);

      // Navigate to different directory with completely different items
      rerender({ items: ['x', 'y', 'z'] });
      expect(result.current.selectionCount).toBe(0);
    });

    it('preserves selection when items list is unchanged', () => {
      const { result, rerender } = renderHook(
        ({ items }) => useMultiSelect({ items }),
        { initialProps: { items: ITEMS } }
      );
      act(() => {
        result.current.handleClick('b', mouseEvent({ metaKey: true }));
      });
      expect(result.current.selectionCount).toBe(1);

      // Re-render with same items
      rerender({ items: [...ITEMS] });
      expect(result.current.selectionCount).toBe(1);
      expect(result.current.isSelected('b')).toBe(true);
    });

    it('selectAll on empty items list produces empty set', () => {
      const { result } = renderHook(() => useMultiSelect({ items: [] }));
      act(() => result.current.selectAll());
      expect(result.current.selectionCount).toBe(0);
    });
  });
});
