import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    dangerouslyIgnoreUnhandledErrors: true,
    testTimeout: 10000, // 10 seconds per test
    hookTimeout: 10000, // 10 seconds for hooks (beforeEach, afterEach, etc.)
    teardownTimeout: 5000, // 5 seconds for teardown
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
  },
  resolve: {
    alias: [
      {
        find: '@project/shared/schema',
        replacement: path.resolve(__dirname, '../shared/src/schema.ts'),
      },
      {
        find: '@project/shared/mutator',
        replacement: path.resolve(__dirname, '../shared/src/mutator.ts'),
      },
      {
        find: '@project/shared/types',
        replacement: path.resolve(__dirname, '../shared/src/types.ts'),
      },
      {
        find: '@project/shared/env',
        replacement: path.resolve(__dirname, '../shared/src/env.ts'),
      },
      {
        find: '@project/shared',
        replacement: path.resolve(__dirname, '../shared'),
      },
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
    ],
  },
});