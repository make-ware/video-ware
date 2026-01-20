#!/usr/bin/env node

const { execSync } = require('child_process');

function stopPocketBase() {
  console.log('🛑 Stopping PocketBase...');
  
  try {
    if (process.platform === 'win32') {
      // Windows
      execSync('taskkill /f /im pocketbase.exe', { stdio: 'inherit' });
    } else {
      // Unix-like systems
      execSync('pkill -f pocketbase', { stdio: 'inherit' });
    }
    console.log('✅ PocketBase stopped');
  } catch (error) {
    console.log('ℹ️  No PocketBase process found or already stopped');
  }
}

if (require.main === module) {
  stopPocketBase();
}

module.exports = { stopPocketBase };