const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname);
fs.mkdirSync(assetsDir, { recursive: true });

const logos = [
  {
    name: 'logo1-smart-document-red.svg',
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ea4335"/>
      <stop offset="100%" stop-color="#c53929"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="92" fill="url(#g1)"/>
  <g transform="translate(42,35)">
    <rect x="0" y="0" width="116" height="130" rx="10" fill="white"/>
    <polygon points="86,0 86,40 126,40" fill="#fce8e6"/>
    <rect x="18" y="55" width="80" height="5" rx="2.5" fill="#ea4335"/>
    <rect x="18" y="68" width="60" height="5" rx="2.5" fill="#fce8e6"/>
    <rect x="18" y="81" width="70" height="5" rx="2.5" fill="#fce8e6"/>
    <rect x="18" y="94" width="40" height="5" rx="2.5" fill="#fce8e6"/>
    <text x="58" y="122" font-family="Arial" font-size="32" font-weight="bold" fill="#ea4335" text-anchor="middle">PDF</text>
  </g>
  <text x="100" y="180" font-family="Arial" font-size="13" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="3">SMARTPDF</text>
</svg>`
  },
  {
    name: 'logo2-pdf-shield-red.svg',
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ea4335"/>
      <stop offset="100%" stop-color="#d33426"/>
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="180" height="180" rx="24" fill="url(#g2)"/>
  <g transform="translate(50,30)">
    <path d="M50 0 L100 20 L100 70 C100 100 72 120 50 130 C28 120 0 100 0 70 L0 20 Z" fill="white"/>
    <path d="M50 12 L88 28 L88 70 C88 96 64 114 50 120 C36 114 12 96 12 70 L12 28 Z" fill="#fce8e6"/>
    <text x="50" y="68" font-family="Arial" font-size="32" font-weight="bold" fill="#ea4335" text-anchor="middle">PDF</text>
    <path d="M38 90 L46 100 L62 82" stroke="#34a853" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="100" y="178" font-family="Arial" font-size="13" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="3">SMARTPDF</text>
</svg>`
  },
  {
    name: 'logo3-smart-brain-red.svg',
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <radialGradient id="g3" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fce8e6"/>
      <stop offset="100%" stop-color="#ea4335"/>
    </radialGradient>
  </defs>
  <circle cx="100" cy="100" r="92" fill="url(#g3)"/>
  <g transform="translate(22,18)">
    <path d="M78 0 C60 0 45 10 38 25 C20 28 8 42 8 60 C8 78 20 92 38 96 L38 145 L55 145 L55 120 C60 122 65 123 70 123 L70 145 L88 145 L88 110 L78 105 L78 85 L98 85 L98 68 L108 68 L108 0 Z" fill="white" opacity="0.95"/>
    <path d="M70 12 C58 12 48 20 44 30 C32 32 22 42 22 55 C22 68 32 78 44 80 L44 120 L55 120 L55 100 C58 102 62 103 65 103 L65 120 L78 120 L78 95 L70 90 L70 75 L88 75 L88 60 L95 60 L95 16 Z" fill="#fce8e6"/>
    <text x="60" y="58" font-family="Arial" font-size="28" font-weight="bold" fill="#ea4335" text-anchor="middle">PDF</text>
    <circle cx="82" cy="88" r="3" fill="#34a853"/>
    <path d="M80 88 L84 92 L89 85" stroke="#34a853" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>
  <text x="100" y="178" font-family="Arial" font-size="12" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="3">SMARTPDF</text>
</svg>`
  },
  {
    name: 'logo4-smart-gear-red.svg',
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <linearGradient id="g4" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#c53929"/>
      <stop offset="100%" stop-color="#ea4335"/>
    </linearGradient>
  </defs>
  <rect x="10" y="10" width="180" height="180" rx="22" fill="url(#g4)"/>
  <g transform="translate(42,35)">
    <rect x="0" y="0" width="116" height="130" rx="12" fill="white" opacity="0.95"/>
    <circle cx="58" cy="65" r="42" fill="#fce8e6"/>
    <text x="58" y="73" font-family="Arial" font-size="36" font-weight="bold" fill="#ea4335" text-anchor="middle">PDF</text>
    <g transform="translate(78,24)">
      <circle cx="16" cy="16" r="16" fill="#ea4335"/>
      <text x="16" y="22" font-family="Arial" font-size="20" font-weight="bold" fill="white" text-anchor="middle">S</text>
    </g>
    <path d="M18 102 C38 94 78 94 98 102" stroke="#ea4335" stroke-width="2" fill="none" stroke-dasharray="4,3"/>
    <text x="58" y="120" font-family="Arial" font-size="10" font-weight="bold" fill="#ea4335" text-anchor="middle" letter-spacing="1">SMART</text>
  </g>
  <text x="100" y="178" font-family="Arial" font-size="13" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="3">SMARTPDF</text>
</svg>`
  }
];

logos.forEach(logo => {
  const filePath = path.join(assetsDir, logo.name);
  fs.writeFileSync(filePath, logo.content.trim());
  console.log(`Created: ${logo.name} (${fs.statSync(filePath).size} bytes)`);
});

console.log('\nAll logos ready in assets/');