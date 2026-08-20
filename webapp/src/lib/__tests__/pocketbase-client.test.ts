import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RUNTIME_CONFIG_KEY } from '@/lib/runtime-config';

type Host = typeof globalThis & { [RUNTIME_CONFIG_KEY]?: unknown };

/**
 * The PocketBase client is a module-scoped singleton constructed at import
 * time, so the runtime config has to be on `globalThis` *before* the dynamic
 * `import()` — hence `vi.resetModules()` between cases. Skipping these would
 * leave the actual fix untested; this module is the fix.
 */
async function loadClient() {
  vi.resetModules();
  return import('@/lib/pocketbase-client');
}

beforeEach(() => {
  delete (globalThis as Host)[RUNTIME_CONFIG_KEY];
});

describe('pocketbase-client resolveUrl', () => {
  it('prefers an absolute runtime config over the build-time var', async () => {
    (globalThis as Host)[RUNTIME_CONFIG_KEY] = {
      pocketbaseUrl: 'https://pb.example.com',
    };

    const { default: pb, resolveUrl } = await loadClient();

    expect(resolveUrl()).toBe('https://pb.example.com');
    expect(pb.baseURL).toBe('https://pb.example.com');
  });

  it('resolves a relative runtime config against window.location.origin', async () => {
    (globalThis as Host)[RUNTIME_CONFIG_KEY] = { pocketbaseUrl: '/' };

    const { default: pb, resolveUrl } = await loadClient();

    expect(resolveUrl()).toBe(`${window.location.origin}/`);
    expect(pb.baseURL).toBe(`${window.location.origin}/`);
  });

  it('falls back to the build-time var when no runtime config is set', async () => {
    // Backward-compat gate: unconfigured deployments must behave exactly as
    // they did before the runtime tier existed.
    expect((globalThis as Host)[RUNTIME_CONFIG_KEY]).toBeUndefined();

    const { default: pb, resolveUrl } = await loadClient();

    expect(resolveUrl()).toBe(process.env.NEXT_PUBLIC_POCKETBASE_URL);
    expect(pb.baseURL).toBe(process.env.NEXT_PUBLIC_POCKETBASE_URL);
  });

  it('ignores a malformed runtime config and falls back', async () => {
    (globalThis as Host)[RUNTIME_CONFIG_KEY] = { pocketbaseUrl: 42 };

    const { resolveUrl } = await loadClient();

    expect(resolveUrl()).toBe(process.env.NEXT_PUBLIC_POCKETBASE_URL);
  });
});
