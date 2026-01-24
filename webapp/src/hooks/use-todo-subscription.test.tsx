import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTodoSubscription } from './use-todo-subscription';

// Mock dependencies
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock('@/lib/pocketbase-client', () => ({
  default: {
    collection: vi.fn(() => ({
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
    })),
  },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'test-user-id' },
    isAuthenticated: true,
  })),
}));

describe('useTodoSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSubscribe.mockReset();
    mockUnsubscribe.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should retry without logging to console when subscription fails', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const onUpdate = vi.fn();

    // Setup mock to fail
    mockSubscribe.mockRejectedValue(new Error('Connection failed'));

    // Render hook with autoSubscribe: true (default)
    const { result } = renderHook(() =>
      useTodoSubscription(onUpdate, 'test-user-id', {
        maxRetries: 1,
        retryDelay: 100
      })
    );

    // Advance timer to trigger auto-subscribe
    await act(async () => {
      vi.runAllTimers();
    });

    // Initial state should be connecting (or connected/error if promise resolved immediately)
    // Since mockSubscribe is async (returns promise), and we flushed timers,
    // the subscribe function should have been called.

    // We expect the first subscription attempt to have been made
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    // Wait for the async subscribe to fail
    await act(async () => {
        // flush promises
        await Promise.resolve();
    });

    // Verify error state
    expect(result.current.error).toBeTruthy();

    // Fast-forward time to trigger retry
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Check if console.log was NOT called with the specific message
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringMatching(/Retrying todo subscription/)
    );

    // Check if subscribe was called again (initial + retry)
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });
});
