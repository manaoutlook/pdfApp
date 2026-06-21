// ============================================================
// SmartPDF - Renderer Main (Router / App Shell)
// ============================================================

const { ipcRenderer } = require('electron');

// Platform detection for cross-platform compatibility
const platform = process.platform;
const isMac = platform === 'darwin';
const isWindows = platform === 'win32';
const isLinux = platform === 'linux';

// Expose platform info to feature modules
if (!window.SmartPDF) window.SmartPDF = {};
window.SmartPDF.platform = platform;
window.SmartPDF.isMac = isMac;
window.SmartPDF.isWindows = isWindows;
window.SmartPDF.isLinux = isLinux;
window.SmartPDF.getDevToolsShortcut = function() {
  return isMac ? 'Cmd+Opt+I' : 'Ctrl+Shift+I';
};

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
let sharedLoaded = false;

// Page navigation state (features register via setPageNav)
let pageNavPdfTabs = null;
let pageNavRenderCallback = null;
let pageNavThumbnailCallback = null;

// DOM refs
const toolbarNav = document.getElementById('toolbarNav');
const content = document.getElementById('content');
const featureMeta = document.getElementById('featureMeta');
const pageNavFileNameEl = document.getElementById('pageNavFileName');
const pageNavInfo = document.getElementById('pageNavInfo');
const pageNavThumbnails = document.getElementById('pageNavThumbnails');

// Navigation via toolbar
toolbarNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.toolbar-nav-btn');
  if (!btn) return;

  const feature = btn.dataset.feature;
  if (!feature || feature === currentFeature) return;

  navigateTo(feature);
});

/**
 * Pre-load shared modules that all features depend on.
 * Currently loads the PdfTabs component from shared/components/pdf-tabs.js
 */
function loadSharedModules() {
  if (sharedLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'shared/components/pdf-tabs.js';
    script.onload = () => {
      console.log('Shared modules loaded (PdfTabs)');
      sharedLoaded = true;
      resolve();
    };
    script.onerror = () => {
      console.warn('Shared modules failed to load, continuing without PdfTabs');
      resolve(); // Don't block navigation if shared module fails
    };
    document.body.appendChild(script);
  });
}

function navigateTo(feature) {
  currentFeature = feature;

  // Update active toolbar nav button
  document.querySelectorAll('.toolbar-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.toolbar-nav-btn[data-feature="${feature}"]`).classList.add('active');

  // Clear content
  content.innerHTML = '';

  // Reset page nav sidebar
  resetPageNavSidebar();

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

      // Ensure shared modules are loaded before feature JS
      loadSharedModules().then(() => {
        // Load and execute feature-specific JS
        if (loadedScripts[feature]) {
          loadedScripts[feature]();
        } else {
          const scriptPath = `features/${feature}/${feature}.js`;
          const script = document.createElement('script');
          script.src = scriptPath;
          script.onload = () => {
            if (window.__featureInit && window.__featureInit[feature]) {
              loadedScripts[feature] = window.__featureInit[feature];
              window.__featureInit[feature]();
            }
          };
          document.body.appendChild(script);
        }
      });
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

// ============================================================
// Page Navigation Sidebar API
// ============================================================

/**
 * Register a feature's PdfTabs instance and callbacks so
 * the global page-nav sidebar with thumbnails can control navigation.
 *
 * @param {Object} pdfTabsInstance - The feature's PdfTabs instance
 * @param {Function} renderCallback - Called after page change: () => void
 * @param {Function} thumbnailCallback - Called to render thumbnails: (containerEl) => void
 */
function setPageNav(pdfTabsInstance, renderCallback, thumbnailCallback) {
  pageNavPdfTabs = pdfTabsInstance;
  pageNavRenderCallback = renderCallback;
  pageNavThumbnailCallback = thumbnailCallback;

  updatePageNavSidebar();
}

/**
 * Update the page nav sidebar display based on current state.
 */
function updatePageNavSidebar() {
  const tab = pageNavPdfTabs ? pageNavPdfTabs.getActiveTab() : null;

  if (tab) {
    pageNavFileNameEl.textContent = `📄 ${tab.fileName}`;
    pageNavInfo.textContent = `Page ${tab.currentPage} / ${tab.totalPages}`;
    // Re-render thumbnails
    if (typeof pageNavThumbnailCallback === 'function') {
      pageNavThumbnails.innerHTML = '';
      pageNavThumbnailCallback(pageNavThumbnails);
    }
  } else {
    pageNavFileNameEl.textContent = '📄 No file open';
    pageNavInfo.textContent = 'Page — / —';
    pageNavThumbnails.innerHTML = '';
  }
}

/**
 * Reset the page nav sidebar when switching features.
 */
function resetPageNavSidebar() {
  pageNavPdfTabs = null;
  pageNavRenderCallback = null;
  pageNavThumbnailCallback = null;
  pageNavFileNameEl.textContent = '📄 No file open';
  pageNavInfo.textContent = 'Page — / —';
  pageNavThumbnails.innerHTML = '';
}

// Click a thumbnail to navigate to that page
pageNavThumbnails.addEventListener('click', (e) => {
  const item = e.target.closest('.page-nav-thumb-item');
  if (!item || !pageNavPdfTabs || !pageNavRenderCallback) return;

  const pageNum = parseInt(item.dataset.page, 10);
  if (!pageNum) return;

  if (pageNavPdfTabs.goToPage(pageNum)) {
    pageNavRenderCallback();
    updatePageNavSidebar();
  }
});

// Keyboard navigation: ArrowUp / ArrowDown (also ArrowLeft/ArrowRight for convenience)
document.addEventListener('keydown', (e) => {
  if (!pageNavPdfTabs || !pageNavRenderCallback) return;

  let changed = false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    changed = pageNavPdfTabs.nextPage();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    changed = pageNavPdfTabs.prevPage();
  }

  if (changed) {
    e.preventDefault();
    pageNavRenderCallback();
    updatePageNavSidebar();
    // Scroll the active thumbnail into view
    const activeThumb = pageNavThumbnails.querySelector('.page-nav-thumb-item.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});

// ============================================================
// Expose API for feature modules
// ============================================================
if (!window.SmartPDF) window.SmartPDF = {};
window.SmartPDF.setPageNav = setPageNav;
window.SmartPDF.updatePageNavSidebar = updatePageNavSidebar;

// Initialize with eSign feature
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('esign');
});