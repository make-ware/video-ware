/**
 * Server-injected runtime configuration.
 *
 * `NEXT_PUBLIC_*` variables are inlined into the client bundle by `next build`,
 * so changing them at container start has no effect on the browser. Anything
 * an operator must be able to retune without a rebuild therefore travels a
 * different road: the Next server reads it from `process.env` **inside the
 * request path**, and the root layout emits it as an inline `<script>` that
 * sets `globalThis.__VW_RUNTIME_CONFIG__` before any bundle chunk runs.
 *
 * This module is the whole contract, and it is deliberately isomorphic (no
 * `server-only`, no Node builtins) so both the injector and the browser-side
 * reader can share it. Every function here is pure.
 *
 * Rule: read `process.env` inside the request path, never at module scope —
 * a module-scope read is evaluated during `next build` and bakes the value in
 * again, which is the exact bug this exists to fix.
 */

export const RUNTIME_CONFIG_KEY = '__VW_RUNTIME_CONFIG__';

export interface PublicRuntimeConfig {
  /** Browser-facing PocketBase origin (may be relative, e.g. `/`). */
  pocketbaseUrl: string;
}

type RuntimeConfigHost = typeof globalThis & {
  [RUNTIME_CONFIG_KEY]?: unknown;
};

/**
 * The runtime browser-facing PocketBase URL, or `undefined` when unset.
 *
 * `PUBLIC_POCKETBASE_URL` is intentionally the *only* knob read here.
 * A runtime `NEXT_PUBLIC_POCKETBASE_URL` must never feed this value: both
 * `.env.example` and `docker-compose.yml` have carried an inert
 * `http://localhost:8090` for years, and operators have copied it into runtime
 * env knowing it did nothing. Honouring it now would silently break every
 * working same-origin deployment behind a reverse proxy. Opting in is explicit.
 */
export function resolvePublicPocketbaseUrl(
  env: Record<string, string | undefined>
): string | undefined {
  return env.PUBLIC_POCKETBASE_URL?.trim() || undefined;
}

/** Read the injected config off `globalThis`, shape-checked. */
export function readRuntimeConfig(): PublicRuntimeConfig | undefined {
  const raw = (globalThis as RuntimeConfigHost)[RUNTIME_CONFIG_KEY];
  if (typeof raw !== 'object' || raw === null) return undefined;

  const { pocketbaseUrl } = raw as Partial<PublicRuntimeConfig>;
  if (typeof pocketbaseUrl !== 'string' || pocketbaseUrl === '') {
    return undefined;
  }

  return { pocketbaseUrl };
}

/** Set the config on `globalThis` (used server-side by `instrumentation.ts`). */
export function writeRuntimeConfig(config: PublicRuntimeConfig): void {
  (globalThis as RuntimeConfigHost)[RUNTIME_CONFIG_KEY] = config;
}

/**
 * The body of the inline `<script>` the root layout emits.
 *
 * `<` is escaped so no configured value can close the script tag early —
 * `</script>` inside a JSON string would otherwise terminate the element.
 */
export function runtimeConfigScript(config: PublicRuntimeConfig): string {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `globalThis.${RUNTIME_CONFIG_KEY}=${json};`;
}
