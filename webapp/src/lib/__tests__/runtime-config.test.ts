import { describe, it, expect, afterEach } from 'vitest';
import {
  RUNTIME_CONFIG_KEY,
  readRuntimeConfig,
  resolvePublicPocketbaseUrl,
  runtimeConfigScript,
  writeRuntimeConfig,
} from '@/lib/runtime-config';

type Host = typeof globalThis & { [RUNTIME_CONFIG_KEY]?: unknown };

afterEach(() => {
  delete (globalThis as Host)[RUNTIME_CONFIG_KEY];
});

describe('resolvePublicPocketbaseUrl', () => {
  it('returns the runtime var when set', () => {
    expect(
      resolvePublicPocketbaseUrl({
        PUBLIC_POCKETBASE_URL: 'https://pb.example.com',
      })
    ).toBe('https://pb.example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(
      resolvePublicPocketbaseUrl({
        PUBLIC_POCKETBASE_URL: '  https://pb.example.com \n',
      })
    ).toBe('https://pb.example.com');
  });

  it('treats unset, empty and whitespace-only as unconfigured', () => {
    expect(resolvePublicPocketbaseUrl({})).toBeUndefined();
    expect(
      resolvePublicPocketbaseUrl({ PUBLIC_POCKETBASE_URL: undefined })
    ).toBeUndefined();
    expect(
      resolvePublicPocketbaseUrl({ PUBLIC_POCKETBASE_URL: '' })
    ).toBeUndefined();
    expect(
      resolvePublicPocketbaseUrl({ PUBLIC_POCKETBASE_URL: '   ' })
    ).toBeUndefined();
  });

  it('keeps a relative value as-is', () => {
    expect(resolvePublicPocketbaseUrl({ PUBLIC_POCKETBASE_URL: '/' })).toBe(
      '/'
    );
  });

  // The hazard the whole design exists to avoid: operators have copied the
  // inert `NEXT_PUBLIC_POCKETBASE_URL=http://localhost:8090` from
  // .env.example / docker-compose.yml into runtime env for years. Honouring
  // it now would break every working same-origin deployment.
  it('never falls back to a runtime NEXT_PUBLIC_POCKETBASE_URL', () => {
    expect(
      resolvePublicPocketbaseUrl({
        NEXT_PUBLIC_POCKETBASE_URL: 'http://localhost:8090',
      })
    ).toBeUndefined();
  });
});

describe('runtimeConfigScript', () => {
  it('assigns the config onto globalThis under the documented key', () => {
    expect(
      runtimeConfigScript({ pocketbaseUrl: 'https://pb.example.com' })
    ).toBe(
      `globalThis.${RUNTIME_CONFIG_KEY}={"pocketbaseUrl":"https://pb.example.com"};`
    );
  });

  it('escapes < so a value can never close the script tag', () => {
    const script = runtimeConfigScript({
      pocketbaseUrl: '</script><script>alert(1)</script>',
    });

    expect(script).not.toContain('</script>');
    expect(script).not.toContain('<');
    expect(script).toContain('\\u003c/script>');
  });

  it('round-trips the escaped payload back to the original value', () => {
    const pocketbaseUrl = '</script>';
    const script = runtimeConfigScript({ pocketbaseUrl });
    const json = script.slice(script.indexOf('=') + 1, script.lastIndexOf(';'));

    // `\u003c` is a JSON escape for `<`, so JSON.parse restores the original.
    expect(JSON.parse(json)).toEqual({ pocketbaseUrl });
  });
});

describe('readRuntimeConfig', () => {
  it('returns undefined when the global is absent', () => {
    expect(readRuntimeConfig()).toBeUndefined();
  });

  it('reads back what writeRuntimeConfig set', () => {
    writeRuntimeConfig({ pocketbaseUrl: 'https://pb.example.com' });
    expect(readRuntimeConfig()).toEqual({
      pocketbaseUrl: 'https://pb.example.com',
    });
  });

  it('rejects malformed globals rather than trusting them', () => {
    const host = globalThis as Host;

    host[RUNTIME_CONFIG_KEY] = null;
    expect(readRuntimeConfig()).toBeUndefined();

    host[RUNTIME_CONFIG_KEY] = 'https://pb.example.com';
    expect(readRuntimeConfig()).toBeUndefined();

    host[RUNTIME_CONFIG_KEY] = {};
    expect(readRuntimeConfig()).toBeUndefined();

    host[RUNTIME_CONFIG_KEY] = { pocketbaseUrl: '' };
    expect(readRuntimeConfig()).toBeUndefined();

    host[RUNTIME_CONFIG_KEY] = { pocketbaseUrl: 42 };
    expect(readRuntimeConfig()).toBeUndefined();
  });
});
