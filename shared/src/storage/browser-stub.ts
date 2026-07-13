/**
 * Browser stand-in for `@project/shared/storage`.
 *
 * The real module is server-only: it imports Node built-ins (fs, path,
 * stream, util) and the AWS SDK. The package.json `exports` map serves THIS
 * file whenever a bundler resolves the subpath with the `browser` condition
 * (Next.js client bundles, Vite, esbuild platform=browser, …), so an
 * accidental client-side import fails loudly at module evaluation instead of
 * silently shipping fs shims and the AWS SDK to the browser.
 *
 * Node consumers (NestJS worker, Next.js server components / API routes,
 * vitest node environment) never see this file — they resolve the real
 * `./index` via the `import`/`require` conditions.
 *
 * If you hit this error you either:
 *  - imported storage from a client component / client-reachable module —
 *    move that work behind an API route or a server action; or
 *  - need a pure helper that currently lives under storage — move it to an
 *    isomorphic entrypoint (root, utils, config) instead of importing the
 *    whole server module.
 */
export {};

throw new Error(
  '@project/shared/storage is server-only (Node fs/streams + AWS SDK) and ' +
    'cannot be imported from browser code. Import it only from server ' +
    'modules (API routes, server components, the worker), or move the pure ' +
    'helper you need to an isomorphic entrypoint.'
);
