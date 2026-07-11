import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// The release version is the repo root package.json version — the single
// version release-please bumps. The release workflow checks out the release
// tag before bundling, so this is always the tagged version in CI.
const rootPkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version?: string };

// Standalone single-file build for GitHub release assets / Homebrew. Unlike
// tsup.config.ts (which keeps deps external for in-repo use), this bundles
// every dependency — including @project/shared, so `yarn build:shared` must
// run first — into one self-contained script.
export default defineConfig({
  entry: { vw: 'src/cli.ts' },
  outDir: 'dist-bundle',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: false,
  dts: false,
  noExternal: [/.*/],
  define: {
    __VW_VERSION__: JSON.stringify(rootPkg.version ?? '0.0.0'),
  },
  banner: {
    // The createRequire shim keeps any CJS `require` calls that survive
    // bundling working inside the ESM output.
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __vwCreateRequire } from 'node:module';",
      'const require = __vwCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
