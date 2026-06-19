import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  dts: false,
  // Keep workspace + npm deps external — they are resolved from node_modules at
  // runtime (the CLI runs inside the monorepo, like the worker).
  banner: {
    js: '#!/usr/bin/env node',
  },
});
