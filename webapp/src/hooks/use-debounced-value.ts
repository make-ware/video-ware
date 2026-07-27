'use client';

/**
 * Trailing-edge debounce for a rapidly changing value — the standard wrapper
 * around a list's raw search input before it reaches a query key.
 *
 * Every filterable list needs this: without it each keystroke is its own query
 * key, so a five-letter search costs five round trips (and five cache entries)
 * to show one result set.
 */
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
