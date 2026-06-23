#!/usr/bin/env node

/**
 * Ensures a root `.env` exists before setup runs.
 *
 * Developers who skip the "copy .env.example to .env" step would otherwise end
 * up with no admin account (the PocketBase superuser upsert is skipped when
 * POCKETBASE_ADMIN_PASSWORD is unset). Seeding `.env` from `.env.example` makes
 * `yarn install && yarn setup && yarn build` work out of the box.
 *
 * Non-destructive: an existing `.env` is never overwritten. This script never
 * fails the chain — a missing `.env.example` only prints a warning.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const examplePath = path.join(rootDir, '.env.example');

if (fs.existsSync(envPath)) {
  console.log('✅ .env already exists — leaving it untouched');
} else if (fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, envPath);
  console.log(
    '📝 Created .env from .env.example. Edit it to set your own admin credentials and secrets.'
  );
} else {
  console.warn(
    '⚠️  No .env or .env.example found — continuing with built-in defaults.'
  );
}
