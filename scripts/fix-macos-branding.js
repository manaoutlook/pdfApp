#!/usr/bin/env node
/**
 * Fix macOS branding: Modify Electron binary's CFBundleName from "Electron" to "SmartPDF"
 * Icon is provided by the committed assets/logo.png — do NOT overwrite it.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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