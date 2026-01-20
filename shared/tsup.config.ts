import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: {
    index: 'src/index.ts',
    schema: 'src/schema.ts',
    enums: 'src/enums.ts',
    types: 'src/types.ts',
    mutator: 'src/mutator.ts',
    jobs: 'src/jobs/index.ts',
    env: 'src/env.ts',
    'utils/time': 'src/utils/time.ts',
    'storage/index': 'src/storage/index.ts',
    'config/index': 'src/config/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: !options.watch, // Only clean when not in watch mode
  sourcemap: true,
  minify: false,
  splitting: false,
  treeshake: true,
}));
