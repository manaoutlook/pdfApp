#!/usr/bin/env node
/**
 * SmartPDF - Cross-platform Post-Install Script
 *
 * Runs platform-specific setup tasks after npm install.
 * - macOS: Fixes CFBundleName in Electron.app Info.plist
 * - Windows: No special postinstall needed (electron-builder handles it)
 * - Linux: No special postinstall needed
 */
'use strict';

const platform = process.platform;

console.log('\n=== SmartPDF Post-Install Setup ===\n');
console.log('Platform:', platform);

if (platform === 'darwin') {
  // macOS: Run the macOS branding fix
  console.log('Running macOS-specific setup...');
  try {
    require('./fix-macos-branding.js');
  } catch (err) {
    console.error('Failed to run macOS branding fix:', err.message);
    console.log('This is non-critical; continuing...');
  }
} else if (platform === 'win32') {
  console.log('Windows detected: No additional postinstall steps needed.');
  console.log('electron-builder handles Windows installer config (NSIS)');
  console.log('from the build configuration in package.json.');
} else if (platform === 'linux') {
  console.log('Linux detected: No additional postinstall steps needed.');
  console.log('electron-builder handles Linux AppImage/deb packaging');
  console.log('from the build configuration in package.json.');
} else {
  console.log('Unknown platform (' + platform + '): Skipping platform-specific setup.');
}

console.log('\n=== Post-Install Setup Complete ===\n');