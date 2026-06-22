// ============================================================
// SmartPDF - Renderer Main (Router / App Shell)
// Creates a shared PdfTabs singleton that persists across
// all features so PDFs stay loaded when switching features.
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
  preview:  { label: 'Preview',  path: 'features/preview/preview.html' },
  esign:    { label: 'eSign',    path: 'features/esign/esign.html' },
  compress: { label: 'Compress', path: 'features/compress/compress.html' },
  merge:    { label: 'Merge',    path: 'features/merge/merge.html' },
  split:    { label: 'Split',    path: 'features/split/split.html' },
};

let currentFeature = 'preview';
let sharedLoaded = false;

let sharedPdfTabs = null;
let sharedStatusBar = null;

// ============================================================
// Page navigation state (features register via setPageNav)
// ============================================================
let pageNavPdfTabs = null;
let pageNavRenderCallback = null;
let pageNavThumbnailCallback = null;

// ============================================================
// DOM refs
// ============================================================
const toolbarNav = document.getElementById('toolbarNav');
const content = document.getElementById('content');
const featureMeta = document.getElementById('featureMeta');
const pageNavInfo = document.getElementById('pageNavInfo');
const pageNavThumbnails = document.getElementById('pageNavThumbnails');
const globalTabBar = document.getElementById('globalTabBar');
const globalTabScroll = document.getElementById('globalTabScroll');

// ============================================================
// Left Sidebar Toggle (Page Navigation)
// ============================================================
const pageNavSidebar = document.getElementById('pageNavSidebar');
const pageNavToggle = document.getElementById('pageNavToggle');
let pageNavCollapsed = false;

pageNavToggle.addEventListener('click', () => {
  pageNavCollapsed = !pageNavCollapsed;
  pageNavSidebar.classList.toggle('collapsed', pageNavCollapsed);
  pageNavToggle.title = pageNavCollapsed ? 'Expand Page Navigation' : 'Collapse Page Navigation';
  pageNavToggle.querySelector('svg').style.transform = pageNavCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
});

// Navigation via toolbar
toolbarNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.toolbar-nav-btn');
  if (!btn) return;

  const feature = btn.dataset.feature;
  if (!feature || feature === currentFeature) return;

  navigateTo(feature);
});

// ============================================================
// Shared Module Loading
// ============================================================
function loadSharedModules() {
  if (sharedLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    // Load pdf-tabs.js first, then continuous-pdf-viewer.js
    const script1 = document.createElement('script');
    script1.src = 'shared/components/pdf-tabs.js';
    script1.onload = () => {
      console.log('Shared module loaded: PdfTabs');
      const script2 = document.createElement('script');
      script2.src = 'shared/components/continuous-pdf-viewer.js';
      script2.onload = () => {
        console.log('Shared module loaded: ContinuousPdfViewer');
        // Load status-bar.js
        const script3 = document.createElement('script');
        script3.src = 'shared/components/status-bar.js';
        script3.onload = () => {
          console.log('Shared module loaded: StatusBar');
          // Load thumbnail-renderer.js (shared service)
          const script4 = document.createElement('script');
          script4.src = 'shared/services/thumbnail-renderer.js';
          script4.onload = () => {
            console.log('Shared module loaded: ThumbnailRenderer');
            sharedLoaded = true;
            initSharedPdfTabs();
            initSharedStatusBar();
            resolve();
          };
          script4.onerror = () => {
            console.warn('ThumbnailRenderer failed to load, continuing without it');
            sharedLoaded = true;
            initSharedPdfTabs();
            initSharedStatusBar();
            resolve();
          };
          document.body.appendChild(script4);
        };
        script3.onerror = () => {
          console.warn('StatusBar failed to load, continuing without it');
          sharedLoaded = true;
          initSharedPdfTabs();
          resolve();
        };
        document.body.appendChild(script3);
      };
      script2.onerror = () => {
        console.warn('ContinuousPdfViewer failed to load, continuing without it');
        sharedLoaded = true;
        initSharedPdfTabs();
        resolve();
      };
      document.body.appendChild(script2);
    };
    script1.onerror = () => {
      console.warn('PdfTabs failed to load, continuing without shared modules');
      resolve();
    };
    document.body.appendChild(script1);
  });
}

/**
 * Create the shared PdfTabs singleton using the global tab bar.
 * Called once after shared modules are loaded.
 */
function initSharedPdfTabs() {
  if (sharedPdfTabs) return;
  if (!window.SmartPDF.PdfTabs) {
    console.warn('PdfTabs module not available, skipping global tab bar');
    return;
  }

  const PdfTabs = window.SmartPDF.PdfTabs;
  sharedPdfTabs = new PdfTabs({
    tabBarEl: globalTabBar,
    tabScrollEl: globalTabScroll,
    onTabSwitch: onGlobalTabSwitched,
    onTabClose: onGlobalTabClosed,
    onDocumentLoad: onGlobalDocumentLoaded,
  });

  // Expose to all feature modules
  window.SmartPDF.sharedPdfTabs = sharedPdfTabs;
  pageNavPdfTabs = sharedPdfTabs;

  console.log('Shared PdfTabs singleton initialized on global tab bar');
}

/**
 * Create the shared StatusBar singleton.
 */
function initSharedStatusBar() {
  if (sharedStatusBar) return;
  if (!window.SmartPDF.StatusBar) {
    console.warn('StatusBar module not available, skipping global status bar');
    return;
  }

  const StatusBar = window.SmartPDF.StatusBar;
  sharedStatusBar = new StatusBar();

  // Wire up callbacks — these delegate to the current feature's handlers
  sharedStatusBar.onPrevPage = () => {
    if (pageNavPdfTabs && pageNavPdfTabs.prevPage()) {
      if (typeof pageNavRenderCallback === 'function') pageNavRenderCallback();
      updateStatusBarFromTab();
    }
  };

  sharedStatusBar.onNextPage = () => {
    if (pageNavPdfTabs && pageNavPdfTabs.nextPage()) {
      if (typeof pageNavRenderCallback === 'function') pageNavRenderCallback();
      updateStatusBarFromTab();
    }
  };

  sharedStatusBar.onZoomChange = (scale, mode) => {
    if (typeof window.SmartPDF.onGlobalZoomChange === 'function') {
      window.SmartPDF.onGlobalZoomChange(scale, mode);
    }
  };

  // Expose to all feature modules
  window.SmartPDF.sharedStatusBar = sharedStatusBar;
  console.log('Shared StatusBar singleton initialized');
}

function updateStatusBarFromTab() {
  if (!sharedStatusBar || !pageNavPdfTabs) return;
  const tab = pageNavPdfTabs.getActiveTab();
  if (tab) {
    sharedStatusBar.setPage(tab.currentPage, tab.totalPages);
    sharedStatusBar.show();
    sharedStatusBar.setFitEnabled(true);
  } else {
    sharedStatusBar.hide();
    sharedStatusBar.setFitEnabled(false);
  }
}

// ============================================================
// Global Tab Bar Callbacks
// ============================================================
function onGlobalTabSwitched(tab) {
  // Fire the current feature's render callback (re-render the viewer)
  if (typeof pageNavRenderCallback === 'function') {
    pageNavRenderCallback();
  }
  updatePageNavSidebar();
}

function onGlobalTabClosed(tabId) {
  // Fire the current feature's render callback
  if (typeof pageNavRenderCallback === 'function') {
    pageNavRenderCallback();
  }
  updatePageNavSidebar();
}

function onGlobalDocumentLoaded(tab) {
  // Fire the current feature's render callback
  if (typeof pageNavRenderCallback === 'function') {
    pageNavRenderCallback();
  }
  updatePageNavSidebar();
}

// ============================================================
// Navigation
// ============================================================
function navigateTo(feature) {
  currentFeature = feature;

  // Update active toolbar nav button
  document.querySelectorAll('.toolbar-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.toolbar-nav-btn[data-feature="${feature}"]`).classList.add('active');

  // Clear content (keep global tab bar intact — it's outside content)
  content.innerHTML = '';

  // Reset page nav sidebar callbacks (PdfTabs itself persists)
  pageNavRenderCallback = null;
  pageNavThumbnailCallback = null;

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
        // Feature JS will pick up window.SmartPDF.sharedPdfTabs
        const script = document.createElement('script');
        script.src = `features/${feature}/${feature}.js`;
        document.body.appendChild(script);
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
// Feature Sidebar Toggle (shared utility)
// ============================================================
window.SmartPDF.toggleFeatureSidebar = function() {
  const sidebar = document.querySelector('.feature-sidebar');
  if (!sidebar) return;
  const toggle = sidebar.querySelector('.feature-sidebar-toggle');
  const isCollapsed = sidebar.classList.toggle('collapsed');
  if (toggle) {
    toggle.title = isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
    toggle.querySelector('svg').style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
  }
};

// ============================================================
// Error Toast Notification (shared utility)
// ============================================================
window.SmartPDF.showErrorToast = function(message, duration) {
  if (!duration) duration = 4000;
  // Remove any existing toast
  var existing = document.getElementById('smartpdf-error-toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.id = 'smartpdf-error-toast';
  toast.textContent = message;
  toast.style.cssText = [
    'position: fixed',
    'bottom: 60px',
    'left: 50%',
    'transform: translateX(-50%)',
    'background: #ea4335',
    'color: #fff',
    'padding: 10px 24px',
    'border-radius: 6px',
    'font-size: 13px',
    'font-family: inherit',
    'z-index: 10000',
    'box-shadow: 0 4px 12px rgba(0,0,0,0.3)',
    'animation: toastSlideIn 0.3s ease-out',
    'max-width: 90vw',
    'text-align: center',
    'pointer-events: none'
  ].join(';');
  document.body.appendChild(toast);

  var timeout = setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
  }, duration);
};

// Inject keyframe animation for toast
(function injectToastKeyframes() {
  if (document.getElementById('smartpdf-toast-keyframes')) return;
  var style = document.createElement('style');
  style.id = 'smartpdf-toast-keyframes';
  style.textContent = '@keyframes toastSlideIn { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }';
  document.head.appendChild(style);
})();

// ============================================================
// Status Bar API (exposed for features)
// ============================================================
window.SmartPDF.updateGlobalStatusBar = function(tab, scaleOverride) {
  if (!sharedStatusBar) return;
  if (tab) {
    sharedStatusBar.setPage(tab.currentPage, tab.totalPages);
    sharedStatusBar.setFitEnabled(true);
    sharedStatusBar.show();
    if (typeof scaleOverride === 'number') {
      sharedStatusBar.setZoom(scaleOverride);
      sharedStatusBar.updateZoomButtons(scaleOverride);
    }
  }
};

// ============================================================
// Page Navigation Sidebar API
// ============================================================

/**
 * Register a feature's render and thumbnail callbacks.
 * PdfTabs is the shared singleton; only callbacks are per-feature.
 *
 * @param {Function} renderCallback - Called after page change: () => void
 * @param {Function} thumbnailCallback - Called to render thumbnails: (containerEl) => void
 */
function setPageNav(renderCallback, thumbnailCallback) {
  pageNavRenderCallback = renderCallback;
  pageNavThumbnailCallback = thumbnailCallback;
  updateStatusBarFromTab();
  updatePageNavSidebar();
}

function updatePageNavSidebar() {
  const tab = pageNavPdfTabs ? pageNavPdfTabs.getActiveTab() : null;

  if (tab) {
    pageNavInfo.textContent = `Page ${tab.currentPage} / ${tab.totalPages}`;
    if (typeof pageNavThumbnailCallback === 'function') {
      pageNavThumbnails.innerHTML = '';
      pageNavThumbnailCallback(pageNavThumbnails);
    }
  } else {
    pageNavInfo.textContent = 'Page — / —';
    pageNavThumbnails.innerHTML = '';
  }
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

// Keyboard navigation
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
    const activeThumb = pageNavThumbnails.querySelector('.page-nav-thumb-item.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});

// Mouse scroll navigation on sidebar
pageNavThumbnails.addEventListener('wheel', (e) => {
  if (!pageNavPdfTabs || !pageNavRenderCallback) return;

  let changed = false;
  if (e.deltaY > 0) {
    changed = pageNavPdfTabs.nextPage();
  } else if (e.deltaY < 0) {
    changed = pageNavPdfTabs.prevPage();
  }

  if (changed) {
    e.preventDefault();
    pageNavRenderCallback();
    updatePageNavSidebar();
    const activeThumb = pageNavThumbnails.querySelector('.page-nav-thumb-item.active');
    if (activeThumb) {
      activeThumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});

// ============================================================
// Expose API for feature modules
// ============================================================
window.SmartPDF.setPageNav = setPageNav;
window.SmartPDF.updatePageNavSidebar = updatePageNavSidebar;

// Initialize with Preview feature
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('preview');
});