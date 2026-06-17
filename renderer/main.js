// ============================================================
// SmartPDF - Renderer Main (Router / App Shell)
// ============================================================

const { ipcRenderer } = require('electron');

// Feature registry
const features = {
  esign:   { label: 'eSign',   path: 'features/esign/esign.html' },
  compress:{ label: 'Compress', path: 'features/compress/compress.html' },
  convert: { label: 'Convert',  path: 'features/convert/convert.html' },
  split:   { label: 'Split',    path: 'features/split/split.html' },
  merge:   { label: 'Merge',    path: 'features/merge/merge.html' },
};

let currentFeature = 'esign';
let loadedScripts = {};

// DOM refs
const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content');
const featureMeta = document.getElementById('featureMeta');

// Navigation
sidebar.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-btn');
  if (!btn) return;

  const feature = btn.dataset.feature;
  if (!feature || feature === currentFeature) return;

  navigateTo(feature);
});

function navigateTo(feature) {
  currentFeature = feature;

  // Update active nav button
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-feature="${feature}"]`).classList.add('active');

  // Clear content
  content.innerHTML = '';

  // Load feature HTML
  const featurePath = features[feature].path;
  fetch(featurePath)
    .then(res => res.text())
    .then(html => {
      content.innerHTML = html;
      featureMeta.textContent = `📄 ${features[feature].label}`;

      // Load feature-specific CSS (if not already loaded)
      const cssId = `css-${feature}`;
      if (!document.getElementById(cssId)) {
        const link = document.createElement('link');
        link.id = cssId;
        link.rel = 'stylesheet';
        link.href = `features/${feature}/${feature}.css`;
        document.head.appendChild(link);
      }

      // Load and execute feature-specific JS
      if (loadedScripts[feature]) {
        // Re-run the module
        loadedScripts[feature]();
      } else {
        const scriptPath = `features/${feature}/${feature}.js`;
        // Dynamic import via script element
        const script = document.createElement('script');
        script.src = scriptPath;
        script.onload = () => {
          // Assume the feature module exports an init function on window
          if (window.__featureInit && window.__featureInit[feature]) {
            loadedScripts[feature] = window.__featureInit[feature];
            window.__featureInit[feature]();
          }
        };
        document.body.appendChild(script);
      }
    })
    .catch(err => {
      content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;flex-direction:column;gap:12px;">
          <div style="font-size:48px">🚧</div>
          <h2>${features[feature].label} - Coming Soon</h2>
          <p>This feature is under development.</p>
        </div>
      `;
      featureMeta.textContent = `📄 ${features[feature].label} (Coming Soon)`;
    });
}

// Initialize with eSign feature
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('esign');
});