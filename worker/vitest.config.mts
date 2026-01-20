import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        // emitDecoratorMetadata: true,
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(__dirname, './src'),
      },
      {
        find: '@project/shared/storage',
        replacement: path.resolve(__dirname, '../shared/dist/storage/index.js'),
      },
      {
        // Ensure tests never try to import the real PocketBase client
        find: 'pocketbase',
        replacement: path.resolve(__dirname, './src/__mocks__/pocketbase.ts'),
      }
    ],
  },
});


