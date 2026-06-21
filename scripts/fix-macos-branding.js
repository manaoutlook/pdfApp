#!/usr/bin/env node
/**
 * Fix macOS branding: Modify Electron binary's CFBundleName from "Electron" to "SmartPDF"
 * Icon is provided by the committed assets/logo.png — do NOT overwrite it.
 * This script is macOS-only and will silently skip on Windows/Linux.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Platform guard: skip on non-macOS platforms
if (process.platform !== 'darwin') {
  console.log('=== Skipping macOS Branding Fix (platform: ' + process.platform + ') ===\n');
  console.log('This script only applies to macOS. On Windows and Linux,');
  console.log('electron-builder handles window titles, taskbar icons,');
  console.log('and application names through the build configuration in package.json.');
  process.exit(0);
}

const electronInfoPlist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist');

console.log('=== Fixing macOS Branding ===\n');

// Fix CFBundleName in Electron binary
if (fs.existsSync(electronInfoPlist)) {
  console.log('Updating CFBundleName in Electron.app Info.plist...');
  try {
    execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName SmartPDF" "${electronInfoPlist}"`, { stdio: 'inherit' });
    execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName SmartPDF" "${electronInfoPlist}"`, { stdio: 'inherit' });
    console.log('  ✓ CFBundleName set to SmartPDF');
    console.log('  ✓ CFBundleDisplayName set to SmartPDF');
  } catch (e) {
    console.error('  Failed to update Info.plist:', e.message);
  }
} else {
  console.log('  ⚠ Electron.app Info.plist not found, skipping');
}

console.log('\n=== Done ===');
console.log('Icon is provided by assets/logo.png (committed in the repo).');
console.log('Restart the app with: npm start');
