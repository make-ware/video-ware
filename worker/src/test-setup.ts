import { afterEach, vi } from 'vitest';
import 'reflect-metadata';

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
