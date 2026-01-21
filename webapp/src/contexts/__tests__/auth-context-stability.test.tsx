import { render, act } from '@testing-library/react';
import { AuthProvider } from '../auth-context';
import { useAuth } from '@/hooks/use-auth';
import { vi, describe, it, expect } from 'vitest';
import React, { useRef } from 'react';
import pb from '@/lib/pocketbase-client';

// Mock PocketBase client
// We need to access the listeners outside the mock to trigger them
const listeners: Array<(token: string, record: any) => void> = [];

vi.mock('@/lib/pocketbase-client', () => {
  return {
    default: {
      authStore: {
        isValid: true,
        token: 'token1',
        record: { id: 'user1', updated: '2023-01-01' },
        model: { id: 'user1', updated: '2023-01-01' }, // For backward compat
        onChange: vi.fn((cb) => {
          listeners.push(cb);
          return () => {
            const idx = listeners.indexOf(cb);
            if (idx >= 0) listeners.splice(idx, 1);
          };
        }),
        clear: vi.fn(),
      },
      collection: vi.fn(() => ({
        authRefresh: vi.fn().mockResolvedValue({ record: { id: 'user1', updated: '2023-01-01' } }),
        authWithPassword: vi.fn(),
      })),
    },
  };
});

// Helper to trigger change
function triggerAuthChange(token: string, record: any) {
  listeners.forEach((cb) => cb(token, record));
}

// Component to count renders
function RenderCounter({ onRender }: { onRender: () => void }) {
  useAuth(); // Consume context
  onRender();
  return <div>Rendered</div>;
}

describe('AuthContext Stability', () => {
  it('should not re-render when authStore updates with same user data', async () => {
    let renderCount = 0;

    // Reset listeners
    listeners.length = 0;

    render(
      <AuthProvider>
        <RenderCounter onRender={() => renderCount++} />
      </AuthProvider>
    );

    // Initial render (count = 1)
    // Wait for initAuth to complete (it's async inside useEffect)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Simulate initAuth completion updating the user (which triggers onChange in real life)
    await act(async () => {
      triggerAuthChange('token1', { id: 'user1', updated: '2023-01-01' });
    });

    const initialRenderCount = renderCount;

    // Now trigger authStore change with SAME user
    await act(async () => {
      triggerAuthChange('new-token', { id: 'user1', updated: '2023-01-01' });
    });

    // Verify render count hasn't changed
    expect(renderCount).toBe(initialRenderCount);

    // Trigger authStore change with DIFFERENT user (updated timestamp change)
    await act(async () => {
      triggerAuthChange('new-token-2', { id: 'user1', updated: '2023-01-02' });
    });

    // Verify render count increased
    expect(renderCount).toBeGreaterThan(initialRenderCount);

    const countAfterUpdate = renderCount;

    // Trigger authStore change with DIFFERENT user (ID change)
    await act(async () => {
      triggerAuthChange('new-token-3', { id: 'user2', updated: '2023-01-02' });
    });

    expect(renderCount).toBeGreaterThan(countAfterUpdate);
  });
});
