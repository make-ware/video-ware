#!/usr/bin/env node

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Where a generated superuser credential is kept. Inside pb_data on purpose:
// it only describes that database, so `rm -rf pb/pb_data` takes the credential
// with the account it belongs to, and pb_data is already gitignored.
const SUPERUSER_ENV_FILENAME = '.pb_superuser.env';
// NOT admin@localhost: PocketBase's email validator rejects a single-label
// domain, and `superuser upsert` reports that failure while still exiting 0.
const GENERATED_ADMIN_EMAIL = 'admin@video-ware.local';
// The placeholder pair shipped in .env.example and docker/README.md. Honouring
// it would create a superuser whose password is published in this repository.
const PLACEHOLDER_ADMIN_EMAIL = 'admin@example.com';
const PLACEHOLDER_ADMIN_PASSWORD = 'your-secure-password';
const UPSERT_SUCCESS = 'Successfully saved superuser';

const PLATFORM_MAP = {
  'darwin': 'darwin',
  'linux': 'linux',
  'win32': 'windows'
};

// 32 alphanumeric characters. Alphanumeric on purpose: the value gets pasted
// into shells, .env files and URLs by whoever reads it back out of the
// credentials file, and a quoting mistake in a generated password is a silent
// lockout. randomInt rather than randomBytes[i] % 62 - 256 is not a multiple of
// 62, so the modulo would bias the first eight letters of the alphabet.
function randomSecret() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

// Reads one KEY=value pair out of the credentials file. Parsed, never
// evaluated, and symmetric with read_env_value() in docker/pb-superuser.sh.
function readEnvValue(contents, key) {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${key}=`)) continue;
    const value = trimmed.slice(key.length + 1).trim();
    const quoted = /^'(.*)'$/.exec(value) || /^"(.*)"$/.exec(value);
    return quoted ? quoted[1] : value;
  }
  return '';
}

// Point the repo-root .env at a generated credential pair.
//
// A divergence from the container path, and from inventory-ware, on purpose:
// the worker reads the root .env directly (worker/src/app.module.ts sets
// envFilePath: '../.env') and Joi requires both values, so a `yarn dev` whose
// .env still carries the placeholders would authenticate as an account this
// script deliberately refused to create. Only lines that are missing or still
// hold the published placeholder are touched - a real value is never rewritten.
function syncGeneratedCredentialsToDotEnv(rootEnvPath, email, password) {
  if (!fs.existsSync(rootEnvPath)) return false;

  const original = fs.readFileSync(rootEnvPath, 'utf8');
  const current = {
    POCKETBASE_ADMIN_EMAIL: readEnvValue(original, 'POCKETBASE_ADMIN_EMAIL'),
    POCKETBASE_ADMIN_PASSWORD: readEnvValue(original, 'POCKETBASE_ADMIN_PASSWORD')
  };
  const placeholder = {
    POCKETBASE_ADMIN_EMAIL: PLACEHOLDER_ADMIN_EMAIL,
    POCKETBASE_ADMIN_PASSWORD: PLACEHOLDER_ADMIN_PASSWORD
  };
  const generated = {
    POCKETBASE_ADMIN_EMAIL: email,
    POCKETBASE_ADMIN_PASSWORD: password
  };

  // Refuse the whole rewrite if either line holds something real. Replacing one
  // half of an operator's own pair would be worse than leaving both alone.
  for (const key of Object.keys(current)) {
    if (current[key] && current[key] !== placeholder[key]) return false;
  }

  let updated = original;
  for (const key of Object.keys(generated)) {
    const line = `${key}=${generated[key]}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    updated = pattern.test(updated)
      ? updated.replace(pattern, line)
      : `${updated.endsWith('\n') || updated === '' ? updated : `${updated}\n`}${line}\n`;
  }

  if (updated === original) return false;
  fs.writeFileSync(rootEnvPath, updated);
  return true;
}

/**
 * Ensure a PocketBase superuser exists, generating one when none was supplied.
 *
 * Without it a clean checkout leaves PocketBase printing its first-run
 * installer link - a URL pointing at 0.0.0.0:8090 that no browser behind nginx
 * or in a container can reach - and the admin UI is unreachable until someone
 * runs `pocketbase superuser upsert` by hand. Mirrors docker/pb-superuser.sh.
 */
async function upsertSuperuser() {
  const pbDir = path.join(__dirname, '..');
  const isWindows = PLATFORM_MAP[process.platform] === 'windows';
  const executableName = isWindows ? 'pocketbase.exe' : 'pocketbase';
  const executablePath = path.join(pbDir, executableName);
  const pbDataDir = path.join(pbDir, 'pb_data');
  const superuserEnvPath = path.join(pbDataDir, SUPERUSER_ENV_FILENAME);
  const rootEnvPath = path.join(pbDir, '..', '.env');

  if (!fs.existsSync(executablePath)) {
    console.log('⚠️  Skipping superuser creation: PocketBase binary not found');
    return;
  }

  let email = process.env.POCKETBASE_ADMIN_EMAIL;
  let password = process.env.POCKETBASE_ADMIN_PASSWORD;

  // Both are cleared together: clearing only the password would send a setup
  // that used the documented pair into the "exactly one set" error below.
  if (password === PLACEHOLDER_ADMIN_PASSWORD) {
    console.log(`⚠️  Ignoring the placeholder POCKETBASE_ADMIN_EMAIL/PASSWORD pair (${PLACEHOLDER_ADMIN_EMAIL} / ${PLACEHOLDER_ADMIN_PASSWORD}) - a credential will be generated instead. Set both to real values in .env to manage the account yourself.`);
    email = '';
    password = '';
  }

  let generated = false;

  if (email && password) {
    console.log(`👤 Using the superuser credentials from the environment: ${email}`);
  } else if (email || password) {
    // Exactly one set is a typo, not an intention. Guessing the other half
    // would either invent a credential or ignore the one that was given.
    console.error('❌ Set both POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD, or neither - leaving both unset generates a superuser.');
    process.exitCode = 1;
    return;
  } else if (fs.existsSync(superuserEnvPath)) {
    // Reuse what an earlier run generated, so `yarn setup` does not rotate the
    // password out from under someone who wrote it down.
    const contents = fs.readFileSync(superuserEnvPath, 'utf8');
    email = readEnvValue(contents, 'POCKETBASE_ADMIN_EMAIL');
    password = readEnvValue(contents, 'POCKETBASE_ADMIN_PASSWORD');
    if (!email || !password) {
      console.error(`❌ ${superuserEnvPath} does not contain both POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD. Delete it to regenerate, or set both in .env.`);
      process.exitCode = 1;
      return;
    }
    console.log(`👤 Reusing the generated superuser credentials in ${superuserEnvPath}`);
  } else {
    email = GENERATED_ADMIN_EMAIL;
    password = randomSecret();
    generated = true;
    // PocketBase creates pb_data itself on first run, so it may not exist yet.
    fs.mkdirSync(pbDataDir, { recursive: true });
    fs.writeFileSync(
      superuserEnvPath,
      `# Generated by pb/scripts/upsert-pocketbase.js because neither\n` +
      `# POCKETBASE_ADMIN_EMAIL nor POCKETBASE_ADMIN_PASSWORD was set. Delete this\n` +
      `# file to have a new credential pair generated, or set both in .env to\n` +
      `# manage the account yourself - this file is then ignored.\n` +
      `POCKETBASE_ADMIN_EMAIL='${email}'\n` +
      `POCKETBASE_ADMIN_PASSWORD='${password}'\n`,
      // Largely a no-op on Windows/NTFS, hence no "0600" claim in the log there.
      { mode: 0o600 }
    );
  }

  // execFileSync, not execSync: an operator-supplied password containing a
  // quote, $ or ; would otherwise break or inject into the shell string. The
  // output is captured because the exit status alone does not prove anything -
  // `superuser upsert` exits 0 even when PocketBase's validator refuses the
  // account. --hooksDir matters too: a migration that `require`s a module
  // resolves it against the hooks directory, and a failure there defers the app
  // schema to `serve`, whose snapshot can wipe the superuser just created.
  let output = '';
  let failed = false;
  try {
    output = execFileSync(
      executablePath,
      [
        'superuser', 'upsert', email, password,
        `--dir=${pbDataDir}`,
        `--hooksDir=${path.join(pbDir, 'pb_hooks')}`,
        `--migrationsDir=${path.join(pbDir, 'pb_migrations')}`,
      ],
      { cwd: pbDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (error) {
    failed = true;
    output = `${error.stdout || ''}${error.stderr || ''}` || error.message;
  }

  if (!failed && output.includes(UPSERT_SUCCESS)) {
    if (generated) {
      console.log(`✅ Generated a PocketBase superuser: ${email}`);
      console.log(`   password: ${password}`);
      console.log(`   saved to ${superuserEnvPath}${isWindows ? '' : ' (mode 0600)'}`);
      if (syncGeneratedCredentialsToDotEnv(rootEnvPath, email, password)) {
        console.log(`   wrote the same pair to ${rootEnvPath} so the worker can authenticate`);
      }
    } else {
      console.log(`✅ PocketBase superuser ${email} is ready`);
    }
    return;
  }

  console.error(`❌ Could not create the PocketBase superuser ${email} - PocketBase will fall back to printing a first-run installer link.`);
  if (output.trim()) {
    console.error(output.trim());
  }
  process.exitCode = 1;
}

if (require.main === module) {
  upsertSuperuser();
}

module.exports = { upsertSuperuser };
