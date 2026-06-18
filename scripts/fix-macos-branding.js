#!/usr/bin/env node
/**
 * Fix macOS branding issues:
 * 1. Modify Electron binary's CFBundleName from "Electron" to "SmartPDF"
 * 2. Generate a properly centered, macOS-style rounded icon PNG
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const electronInfoPlist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist');

console.log('=== Fixing macOS Branding ===\n');

// 1. Fix CFBundleName in Electron binary
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

// 2. Generate properly centered icon using canvas (already a dependency)
console.log('\nGenerating macOS-optimized icon...');
try {
  const { createCanvas, loadImage } = require('canvas');

  async function generateIcon() {
    const size = 1024; // High resolution
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // macOS-style rounded rectangle as base (approximately 180/200 = 90% of canvas)
    const margin = size * 0.09; // ~9% margin on each side
    const rectSize = size - margin * 2;
    const cornerRadius = rectSize * 0.225; // ~22.5% corner radius for macOS look

    // Background rounded rect with gradient
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#ea4335');
    gradient.addColorStop(1, '#d33426');

    ctx.beginPath();
    ctx.moveTo(margin + cornerRadius, margin);
    ctx.lineTo(margin + rectSize - cornerRadius, margin);
    ctx.quadraticCurveTo(margin + rectSize, margin, margin + rectSize, margin + cornerRadius);
    ctx.lineTo(margin + rectSize, margin + rectSize - cornerRadius);
    ctx.quadraticCurveTo(margin + rectSize, margin + rectSize, margin + rectSize - cornerRadius, margin + rectSize);
    ctx.lineTo(margin + cornerRadius, margin + rectSize);
    ctx.quadraticCurveTo(margin, margin + rectSize, margin, margin + rectSize - cornerRadius);
    ctx.lineTo(margin, margin + cornerRadius);
    ctx.quadraticCurveTo(margin, margin, margin + cornerRadius, margin);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Shield icon - centered in the upper portion
    const shieldScale = 0.50; // 50% of canvas
    const shieldCenterX = size * 0.50;
    const shieldCenterY = size * 0.42;
    const shieldW = size * shieldScale;
    const shieldH = size * shieldScale * 1.1;
    const shieldX = shieldCenterX - shieldW / 2;
    const shieldY = shieldCenterY - shieldH / 2;

    // Outer shield
    ctx.beginPath();
    ctx.moveTo(shieldX + shieldW * 0.5, shieldY); // top center
    ctx.lineTo(shieldX + shieldW, shieldY + shieldH * 0.25); // right shoulder
    ctx.lineTo(shieldX + shieldW, shieldY + shieldH * 0.75); // right bottom
    ctx.quadraticCurveTo(shieldX + shieldW, shieldY + shieldH, shieldX + shieldW * 0.72, shieldY + shieldH * 0.90);
    ctx.quadraticCurveTo(shieldX + shieldW * 0.5, shieldY + shieldH, shieldX + shieldW * 0.28, shieldY + shieldH * 0.90);
    ctx.quadraticCurveTo(shieldX, shieldY + shieldH, shieldX, shieldY + shieldH * 0.75);
    ctx.lineTo(shieldX, shieldY + shieldH * 0.25); // left shoulder
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();

    // Inner shield
    const innerMarginX = shieldW * 0.13;
    const innerMarginY = shieldH * 0.10;
    ctx.beginPath();
    ctx.moveTo(shieldX + shieldW * 0.5, shieldY + innerMarginY);
    ctx.lineTo(shieldX + shieldW - innerMarginX, shieldY + shieldH * 0.28);
    ctx.lineTo(shieldX + shieldW - innerMarginX, shieldY + shieldH * 0.72);
    ctx.quadraticCurveTo(shieldX + shieldW - innerMarginX, shieldY + shieldH - innerMarginY * 1.8, shieldX + shieldW * 0.72, shieldY + shieldH - innerMarginY * 1.4);
    ctx.quadraticCurveTo(shieldX + shieldW * 0.5, shieldY + shieldH - innerMarginY * 0.8, shieldX + shieldW * 0.28, shieldY + shieldH - innerMarginY * 1.4);
    ctx.quadraticCurveTo(shieldX + innerMarginX, shieldY + shieldH - innerMarginY * 1.8, shieldX + innerMarginX, shieldY + shieldH * 0.72);
    ctx.lineTo(shieldX + innerMarginX, shieldY + shieldH * 0.28);
    ctx.closePath();
    ctx.fillStyle = '#fce8e6';
    ctx.fill();

    // "PDF" text
    ctx.fillStyle = '#ea4335';
    ctx.font = `bold ${size * 0.11}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PDF', shieldCenterX, shieldY + shieldH * 0.55);

    // Checkmark
    const checkX = shieldCenterX + shieldW * 0.02;
    const checkY = shieldY + shieldH * 0.70;
    const checkSize = size * 0.07;
    ctx.strokeStyle = '#34a853';
    ctx.lineWidth = size * 0.008;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(checkX - checkSize * 0.45, checkY);
    ctx.lineTo(checkX - checkSize * 0.05, checkY + checkSize * 0.55);
    ctx.lineTo(checkX + checkSize * 0.55, checkY - checkSize * 0.35);
    ctx.stroke();

    // "SMARTPDF" text at bottom
    ctx.fillStyle = 'white';
    ctx.font = `bold ${size * 0.045}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SMARTPDF', size * 0.50, size * 0.88);

    // Save
    const outputPath = path.join(__dirname, '..', 'assets', 'logo.png');
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    console.log(`  ✓ Generated icon: ${outputPath} (${size}x${size})`);
  }

  generateIcon().then(() => {
    console.log('\n=== Done ===');
    console.log('Restart the app with: npm start');
  }).catch(err => {
    console.error('  Failed to generate icon:', err.message);
  });

} catch (e) {
  console.error('  Failed to generate icon with canvas:', e.message);
  console.log('  Falling back to sips...');
  // Fallback
}