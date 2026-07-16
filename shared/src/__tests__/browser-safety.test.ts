import { describe, it, expect } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { builtinModules } from 'module';
import * as path from 'path';

/**
 * Browser-safety contract for @project/shared.
 *
 * This package is consumed by three runtimes: the NestJS worker (Node), the
 * Next.js server (Node), and the Next.js client (browser). Every entrypoint
 * listed in BROWSER_SAFE below must stay importable from browser code —
 * no Node built-ins (fs, path, stream, …) anywhere in its import graph.
 *
 * The test bundles each entry with esbuild for platform=browser. npm
 * dependencies are treated as external (they ship their own browser builds),
 * but Node built-ins are left for esbuild to resolve — which fails on the
 * browser platform, surfacing the offending import chain.
 *
 * If this test fails after you add an import:
 *  - Node-only code belongs in a server-only entrypoint (like ./storage),
 *    which must ALSO get a browser-stub mapping in package.json "exports"
 *    and be listed in SERVER_ONLY here.
 *  - Pure helpers needed by the browser must not live in server-only
 *    modules; move them to an isomorphic entrypoint instead.
 */

const SRC = path.resolve(__dirname, '..');

/** Entrypoints (from tsup.config.ts) that browser code may import. */
const BROWSER_SAFE = [
  'index.ts',
  'schema.ts',
  'enums.ts',
  'types.ts',
  'mutator.ts',
  'jobs/index.ts',
  'env.ts',
  'utils/time.ts',
  'config/index.ts',
];

/** Server-only entrypoints — expected to FAIL a browser bundle. */
const SERVER_ONLY = ['storage/index.ts'];

const NODE_BUILTINS = new Set(builtinModules);

/**
 * Mark bare-specifier npm imports as external, but let Node built-ins fall
 * through to esbuild's own resolver so platform=browser rejects them.
 */
const externalizeNpmDeps: Plugin = {
  name: 'externalize-npm-deps',
  setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('node:')) return undefined;
      const packageName = args.path.startsWith('@')
        ? args.path.split('/').slice(0, 2).join('/')
        : args.path.split('/')[0];
      if (NODE_BUILTINS.has(packageName)) return undefined;
      return { path: args.path, external: true };
    });
  },
};

function bundleForBrowser(entry: string) {
  return build({
    entryPoints: [path.join(SRC, entry)],
    bundle: true,
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    plugins: [externalizeNpmDeps],
  });
}

describe('browser-safe entrypoints contain no Node built-ins', () => {
  it.each(BROWSER_SAFE)('%s bundles for platform=browser', async (entry) => {
    try {
      await bundleForBrowser(entry);
    } catch (error) {
      const messages =
        error && typeof error === 'object' && 'errors' in error
          ? (error as { errors: { text: string; location?: unknown }[] }).errors
              .map((e) => e.text)
              .join('\n')
          : String(error);
      expect.fail(
        `Entry "${entry}" is documented browser-safe but pulled in ` +
          `Node-only code:\n${messages}\n` +
          'Move the Node-only code to a server-only entrypoint (see ./storage).'
      );
    }
  });
});

describe('harness canary', () => {
  // Proves the setup above actually detects Node built-ins: the server-only
  // storage entry MUST fail a browser bundle. If this starts passing, the
  // guard test has gone blind (e.g. built-ins accidentally externalized).
  it.each(SERVER_ONLY)('%s is rejected by a browser bundle', async (entry) => {
    await expect(bundleForBrowser(entry)).rejects.toThrow();
  });
});
