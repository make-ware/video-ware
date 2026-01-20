#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const POCKETBASE_VERSION = process.env.PB_VERSION || '0.35.0';
const PLATFORM_MAP = {
  'darwin': 'darwin',
  'linux': 'linux',
  'win32': 'windows'
};

const ARCH_MAP = {
  'x64': 'amd64',
  'arm64': 'arm64'
};

function getPlatformInfo() {
  const platform = PLATFORM_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  
  if (!platform || !arch) {
    throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`);
  }
  
  return { platform, arch };
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);
    
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
      
      file.on('error', (err) => {
        fs.unlink(dest, () => {}); // Delete the file on error
        reject(err);
      });
    }).on('error', reject);
  });
}

async function downloadPocketBase() {
  try {
    const { platform, arch } = getPlatformInfo();
    const pbDir = path.join(__dirname, '..');
    
    // Create pb directory if it doesn't exist
    if (!fs.existsSync(pbDir)) {
      fs.mkdirSync(pbDir, { recursive: true });
    }
    
    // Determine file extension and executable name
    const isWindows = platform === 'windows';
    const extension = '.zip';
    const executableName = isWindows ? 'pocketbase.exe' : 'pocketbase';
    
    // Construct download URL
    const filename = `pocketbase_${POCKETBASE_VERSION}_${platform}_${arch}${extension}`;
    const downloadUrl = `https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/${filename}`;
    const zipPath = path.join(pbDir, filename);
    const executablePath = path.join(pbDir, executableName);
    
    // Check if PocketBase is already installed
    let needsDownload = false;
    if (fs.existsSync(executablePath)) {
      console.log('✅ PocketBase is already installed');
      
      // Check version
      try {
        const version = execSync(`cd "${pbDir}" && ./${executableName} --version`, { encoding: 'utf8' });
        console.log(`Current version: ${version.trim()}`);
      } catch (err) {
        console.log('⚠️  Existing PocketBase binary seems corrupted, re-downloading...');
        needsDownload = true;
      }
    } else {
      needsDownload = true;
    }
    
    // Download and install PocketBase if needed
    if (needsDownload) {
      console.log(`📦 Setting up PocketBase v${POCKETBASE_VERSION} for ${platform}/${arch}...`);
      
      // Download PocketBase
      await downloadFile(downloadUrl, zipPath);
      console.log('✅ Download completed');
      
      // Extract the zip file
      console.log('📂 Extracting PocketBase...');
      
      if (process.platform === 'win32') {
        // Use PowerShell on Windows
        execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${pbDir}' -Force"`, { stdio: 'inherit' });
      } else {
        // Use unzip on Unix-like systems
        execSync(`cd "${pbDir}" && unzip -o "${filename}"`, { stdio: 'inherit' });
      }
      
      // Make executable on Unix-like systems
      if (!isWindows) {
        execSync(`chmod +x "${executablePath}"`);
      }
      
      // Clean up zip file
      fs.unlinkSync(zipPath);
      
      console.log('✅ PocketBase download completed!');
      console.log(`📍 PocketBase binary location: ${executablePath}`);
    }
  } catch (error) {
    console.error('❌ Error downloading PocketBase:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  downloadPocketBase();
}

module.exports = { downloadPocketBase };