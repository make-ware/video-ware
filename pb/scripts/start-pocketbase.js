#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLATFORM_MAP = {
  'darwin': 'darwin',
  'linux': 'linux',
  'win32': 'windows'
};

function startPocketBase() {
  console.log('🚀 Starting PocketBase...');
  
  const pbDir = path.join(__dirname, '..');
  const pbDataDir = path.join(pbDir, 'pb_data');
  const isWindows = PLATFORM_MAP[process.platform] === 'windows';
  const executableName = isWindows ? 'pocketbase.exe' : 'pocketbase';
  const pbPath = path.join(pbDir, executableName);
  
  if (!fs.existsSync(pbPath)) {
    console.error('❌ PocketBase not found. Run "yarn pb:download" first.');
    process.exit(1);
  }
  
  // Create directories if they don't exist
  if (!fs.existsSync(pbDataDir)) {
    fs.mkdirSync(pbDataDir, { recursive: true });
  }
  
  // Start PocketBase
  const pb = spawn(pbPath, ['serve', '--dir', pbDataDir], {
    stdio: 'inherit',
    cwd: pbDir
  });
  
  pb.on('error', (error) => {
    console.error('❌ Failed to start PocketBase:', error.message);
    process.exit(1);
  });
  
  pb.on('close', (code) => {
    console.log(`PocketBase exited with code ${code}`);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping PocketBase...');
    pb.kill('SIGINT');
  });
  
  process.on('SIGTERM', () => {
    pb.kill('SIGTERM');
  });
}

if (require.main === module) {
  startPocketBase();
}

module.exports = { startPocketBase };