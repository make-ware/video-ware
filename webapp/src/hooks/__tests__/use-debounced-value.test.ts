import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from '../use-debounced-value';

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('erik'));
    expect(result.current).toBe('erik');
  });

  it('holds the previous value until the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value),
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'ab' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('ab');
  });

  it('emits only the last value across rapid changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value),
      { initialProps: { value: '' } }
    );

    for (const value of ['e', 'er', 'eri', 'erik']) {
      rerender({ value });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    // Each keystroke restarted the timer, so nothing has settled yet.
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('erik');
  });

  it('honours a custom delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 1000),
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current).toBe('b');
  });

  it('clears its timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderHook(() => useDebouncedValue('a'));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
