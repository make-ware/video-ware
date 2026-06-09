import { beforeAll, vi } from 'vitest';

// Silence all stderr output (console.error/warn and direct writes) so the
// test console isn't flooded with logs from code under test.
beforeAll(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
