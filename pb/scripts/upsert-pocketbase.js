#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLATFORM_MAP = {
  'darwin': 'darwin',
  'linux': 'linux',
  'win32': 'windows'
};

/**
 * Creates or updates a PocketBase superuser if credentials are provided via environment variables.
 * Uses upsert, so it will create if it doesn't exist or update if it does.
 */
async function upsertSuperuser() {
  const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
  const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;
  
  // Skip if using default insecure password
  if (adminPassword === undefined || adminPassword === null || adminPassword === '') {
    console.error('❌ POCKETBASE_ADMIN_PASSWORD is not set. Set POCKETBASE_ADMIN_PASSWORD to create/update superuser.');
    return;
  }
  
  try {
    const pbDir = path.join(__dirname, '..');
    const isWindows = PLATFORM_MAP[process.platform] === 'windows';
    const executableName = isWindows ? 'pocketbase.exe' : 'pocketbase';
    const executablePath = path.join(pbDir, executableName);
    const pbDataDir = path.join(pbDir, 'pb_data');
    
    // Ensure executable exists
    if (!fs.existsSync(executablePath)) {
      console.error('❌ PocketBase executable not found. Run "yarn pb:download" first.');
      process.exit(1);
    }
    
    // Ensure pb_data directory exists
    if (!fs.existsSync(pbDataDir)) {
      fs.mkdirSync(pbDataDir, { recursive: true });
    }
    
    console.log('👤 Creating/updating PocketBase superuser...');
    
    // Run superuser upsert command
    // This works even if PocketBase isn't running - it modifies the database directly
    // Upsert will create if it doesn't exist, or update if it does
    execSync(
      `cd "${pbDir}" && ./${executableName} superuser upsert "${adminEmail}" "${adminPassword}" --dir="${pbDataDir}"`,
      { stdio: 'inherit' }
    );
    
    console.log(`✅ Superuser upserted: ${adminEmail}`);
  } catch (error) {
    console.error('❌ Could not create/update superuser:', error.message);
    console.error('   You can create it manually later with:');
    const pbDir = path.join(__dirname, '..');
    const isWindows = PLATFORM_MAP[process.platform] === 'windows';
    const executableName = isWindows ? 'pocketbase.exe' : 'pocketbase';
    console.error(`   cd ${pbDir} && ./${executableName} superuser upsert EMAIL PASSWORD`);
    process.exit(1);
  }
}

if (require.main === module) {
  upsertSuperuser();
}

module.exports = { upsertSuperuser };
