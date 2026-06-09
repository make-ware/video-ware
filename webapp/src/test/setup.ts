import { afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';
import React from 'react';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Silence all stderr output (console.error/warn and direct writes) so the
// test console isn't flooded with logs from code under test.
beforeAll(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// No test exercises real network behavior, but some code paths fire `fetch`
// (e.g. storage cleanup) without awaiting it. Left unmocked, happy-dom keeps
// those requests in-flight and aborts them on window teardown, flooding the
// console with AbortError noise. Stub fetch with an immediately-resolving
// response so nothing is ever left pending.
beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  );
});

// Mock environment variables
process.env.NEXT_PUBLIC_POCKETBASE_URL = 'http://localhost:8090';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    return React.createElement('img', props);
  },
}));

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children?: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => {
    return React.createElement('a', { href, ...props }, children);
  },
}));

// Mock sonner (toast library)
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
