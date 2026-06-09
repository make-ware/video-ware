import { afterEach, beforeAll, vi } from 'vitest';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';

// Silence noisy logging so the test console isn't flooded with output from
// code under test. The NestJS Logger writes to stdout (LOG/DEBUG/WARN) and
// stderr (ERROR), so disable it globally and also stub direct stderr writes.
beforeAll(() => {
  Logger.overrideLogger(false);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Set required environment variables for tests
// These are needed for ConfigModule validation
if (!process.env.POCKETBASE_URL) {
  process.env.POCKETBASE_URL = 'http://localhost:8090';
}
if (!process.env.POCKETBASE_ADMIN_EMAIL) {
  process.env.POCKETBASE_ADMIN_EMAIL = 'test@example.com';
}
if (!process.env.POCKETBASE_ADMIN_PASSWORD) {
  process.env.POCKETBASE_ADMIN_PASSWORD = 'testpassword123';
}

afterEach(() => {
  vi.clearAllMocks();
});
