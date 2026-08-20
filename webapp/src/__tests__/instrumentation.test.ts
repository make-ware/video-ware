import { describe, it, expect, afterEach, vi } from 'vitest';
import { register } from '@/instrumentation';
import { RUNTIME_CONFIG_KEY, readRuntimeConfig } from '@/lib/runtime-config';

type Host = typeof globalThis & { [RUNTIME_CONFIG_KEY]?: unknown };

afterEach(() => {
  delete (globalThis as Host)[RUNTIME_CONFIG_KEY];
  vi.unstubAllEnvs();
});

describe('instrumentation register', () => {
  it('sets the runtime config on the Node server so SSR matches the browser', () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('PUBLIC_POCKETBASE_URL', 'https://pb.example.com');

    register();

    expect(readRuntimeConfig()).toEqual({
      pocketbaseUrl: 'https://pb.example.com',
    });
  });

  it('sets nothing when the runtime var is unset', () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('PUBLIC_POCKETBASE_URL', '');

    register();

    expect(readRuntimeConfig()).toBeUndefined();
  });

  it('never honours a runtime NEXT_PUBLIC_POCKETBASE_URL', () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('PUBLIC_POCKETBASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_POCKETBASE_URL', 'http://localhost:8090');

    register();

    expect(readRuntimeConfig()).toBeUndefined();
  });

  it('skips non-Node runtimes', () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('PUBLIC_POCKETBASE_URL', 'https://pb.example.com');

    register();

    expect(readRuntimeConfig()).toBeUndefined();
  });
});
