import {
  resolvePublicPocketbaseUrl,
  writeRuntimeConfig,
} from '@/lib/runtime-config';

/**
 * Next runs `register()` once per server process, before any route module is
 * imported. Setting the runtime config here means the module-scoped PocketBase
 * singleton in `@/lib/pocketbase-client` resolves the *same* URL during SSR as
 * the browser does after the layout's inline script runs — otherwise the two
 * would disagree and hydration would mismatch.
 */
export function register(): void {
  // Only the Node runtime serves HTML here; skip edge/browser passes.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const pocketbaseUrl = resolvePublicPocketbaseUrl(process.env);
  if (!pocketbaseUrl) return;

  writeRuntimeConfig({ pocketbaseUrl });
}
