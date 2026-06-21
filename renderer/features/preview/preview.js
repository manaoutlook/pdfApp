// ============================================================
// SmartPDF - Preview PDF Feature
// Uses the shared PdfTabs singleton and ContinuousPdfViewer.
// PDFs persist across features via the global tab bar.
// ============================================================

(function () {
  'use strict';

  const { ipcRenderer } = require('electron');

  // ============================================================
  // Zoom Modes
  // ============================================================
  const ZOOM_MODE = {
    CUSTOM: 'custom',
    FIT_PAGE: 'fitPage',
    FIT_HEIGHT: 'fitHeight',
    FIT_WIDTH: 'fitWidth',
    ACTUAL: 'actual',
  };

  const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
  const DEFAULT_SCALE = 1.0;

  const RECENT_FILES_STORAGE_KEY = 'smartpdf-preview-recent-files';
  const MAX_RECENT_FILES = 20;

  // ============================================================
  // State
  // ============================================================
  let pdfTabs = null;      // Shared singleton from window.SmartPDF.sharedPdfTabs
  let pdfViewer = null;    // ContinuousPdfViewer instance
  let recentFiles = [];
  let scale = DEFAULT_SCALE;
  let zoomMode = ZOOM_MODE.CUSTOM;
  let statusBar = null;    // Shared singleton from window.SmartPDF.sharedStatusBar

  function getStatusBar() {
    return window.SmartPDF && window.SmartPDF.sharedStatusBar ? window.SmartPDF.sharedStatusBar : null;
  }

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      pdfDropArea:       document.getElementById('preview-pdfDropArea'),
      pdfPageContainer:  document.getElementById('preview-pdfPageContainer'),
      pdfPagesScroll:    document.getElementById('preview-pdfPagesScroll'),
      pageInfoBottom:    document.getElementById('preview-pageInfoBottom'),
      fileName:          document.getElementById('preview-fileName'),
      openPdfBtn:        document.getElementById('preview-openPdfBtn'),
      // Recent files
      recentSection:     document.getElementById('preview-recentSection'),
      recentList:        document.getElementById('preview-recentList'),
      recentClear:       document.getElementById('preview-recentClear'),
      // Sidebar info
      infoFileName:      document.getElementById('preview-infoFileName'),
      infoPages:         document.getElementById('preview-infoPages'),
      infoCurrentPage:   document.getElementById('preview-infoCurrentPage'),
      infoZoom:          document.getElementById('preview-infoZoom'),
    };
  }

  // ============================================================
  // Shared PdfTabs — use the global singleton
  // ============================================================
  function getPdfTabs() {
    return window.SmartPDF && window.SmartPDF.sharedPdfTabs ? window.SmartPDF.sharedPdfTabs : null;
  }

  function getActiveTab() {
    return pdfTabs ? pdfTabs.getActiveTab() : null;
  }

  // ============================================================
  // Continuous Pdf Viewer
  // ============================================================
  function initPdfViewer() {
    if (!window.SmartPDF || !window.SmartPDF.ContinuousPdfViewer) return;
    const ContinuousPdfViewer = window.SmartPDF.ContinuousPdfViewer;
    pdfViewer = new ContinuousPdfViewer({
      scrollContainerEl: dom.pdfPagesScroll,
      pdfTabs: pdfTabs,
      scale: scale,
      onPageChange: onPageChanged,
    });
  }

  function onPageChanged(pageNum, tab) {
    updateTabInfo(tab);
    updateSidebarInfo(tab);
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function updateTabInfo(tab) {
    dom.pageInfoBottom.textContent = `Page ${tab.currentPage} / ${tab.totalPages}`;
    dom.fileName.textContent = `📄 ${tab.fileName}`;
    // Update shared status bar
    if (statusBar && tab) {
      statusBar.setPage(tab.currentPage, tab.totalPages);
      statusBar.show();
      statusBar.setFitEnabled(true);
      statusBar.setZoom(scale);
      statusBar.updateZoomButtons(scale);
    }
  }

  // ============================================================
  // Recent Files
  // ============================================================
  function loadRecentFiles() {
    try {
      const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
      recentFiles = raw ? JSON.parse(raw) : [];
    } catch (e) { recentFiles = []; }
  }

  function saveRecentFiles() {
    try { localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(recentFiles)); } catch (e) {}
  }

  function addRecentFile(filePath) {
    recentFiles = recentFiles.filter(f => f.filePath !== filePath);
    const fileName = filePath.split(/[/\\]/).pop();
    recentFiles.unshift({ filePath, fileName, openedAt: new Date().toISOString() });
    if (recentFiles.length > MAX_RECENT_FILES) recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
    saveRecentFiles();
    renderRecentFiles();
  }

  function clearRecentFiles() {
    recentFiles = [];
    localStorage.removeItem(RECENT_FILES_STORAGE_KEY);
    renderRecentFiles();
  }

  function renderRecentFiles() {
    if (!dom.recentList || !dom.recentSection) return;
    dom.recentList.innerHTML = '';
    if (recentFiles.length === 0) { dom.recentSection.style.display = 'none'; return; }
    dom.recentSection.style.display = '';
    recentFiles.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'preview-recent-item';
      item.title = file.filePath;
      const icon = document.createElement('span');
      icon.className = 'preview-recent-item-icon';
      icon.textContent = '📄';
      item.appendChild(icon);
      const info = document.createElement('div');
      info.className = 'preview-recent-item-info';
      const name = document.createElement('div');
      name.className = 'preview-recent-item-name';
      name.textContent = file.fileName;
      info.appendChild(name);
      const path = document.createElement('div');
      path.className = 'preview-recent-item-path';
      path.textContent = file.filePath;
      info.appendChild(path);
      item.appendChild(info);
      const time = document.createElement('span');
      time.className = 'preview-recent-item-time';
      time.textContent = formatTimeAgo(file.openedAt);
      item.appendChild(time);
      item.addEventListener('click', () => reopenRecentFile(file.filePath));
      dom.recentList.appendChild(item);
    });
  }

  function formatTimeAgo(isoString) {
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diffMin = Math.floor((now - then) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return diffDay + 'd ago';
    const diffWeek = Math.floor(diffDay / 7);
    if (diffWeek < 4) return diffWeek + 'w ago';
    return new Date(isoString).toLocaleDateString();
  }

  async function reopenRecentFile(filePath) {
    if (!pdfTabs) return;
    if (pdfTabs.isFileOpen(filePath)) return;
    const result = await ipcRenderer.invoke('preview:read-file-by-path', filePath);
    if (!result) {
      alert('File not found: ' + filePath + '\nIt may have been moved or deleted.');
      recentFiles = recentFiles.filter(f => f.filePath !== filePath);
      saveRecentFiles();
      renderRecentFiles();
      return;
    }
    pdfTabs.openFiles([{ filePath: result.filePath, data: result.data }]);
  }

  // ============================================================
  // PDF Loading
  // ============================================================
  async function openPdfDialog() {
    const result = await ipcRenderer.invoke('preview:open-pdf');
    if (!result || !pdfTabs) return;
    if (!Array.isArray(result)) {
      pdfTabs.openFiles([{ filePath: result.filePath, data: result.data }]);
      return;
    }
    pdfTabs.openFiles(result);
  }

  // Call this when a new tab is loaded (from any source)
  function onTabLoaded(tab) {
    dom.pdfPageContainer.classList.remove('hidden');
    dom.pdfDropArea.classList.add('hidden');
    updateTabInfo(tab);
    updateSidebarInfo(tab);
    if (tab.filePath) addRecentFile(tab.filePath);
    pdfViewer.renderAllPages(tab);
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  // Called by main.js when global tab bar switches/closes/loads
  function renderCurrentTab() {
    if (!pdfViewer) return;
    const tab = getActiveTab();
    if (!tab) {
      dom.pdfPageContainer.classList.add('hidden');
      dom.pdfDropArea.classList.remove('hidden');
      resetSidebarInfo();
      if (statusBar) { statusBar.hide(); statusBar.setFitEnabled(false); }
      return;
    }
    onTabLoaded(tab);
  }

  // ============================================================
  // Zoom Utilities
  // ============================================================
  function updateZoomLabel() {
    const pct = Math.round(scale * 100);
    dom.infoZoom.textContent = pct + '%';
    if (statusBar) {
      statusBar.setZoom(scale);
      statusBar.updateZoomButtons(scale);
    }
  }

  function getNextZoomStep(currentScale, direction) {
    const currentPct = Math.round(currentScale * 100);
    if (direction > 0) {
      for (const step of ZOOM_STEPS) { if (Math.round(step * 100) > currentPct) return step; }
      return ZOOM_STEPS[ZOOM_STEPS.length - 1];
    } else {
      for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) { if (Math.round(ZOOM_STEPS[i] * 100) < currentPct) return ZOOM_STEPS[i]; }
      return ZOOM_STEPS[0];
    }
  }

  function zoomIn() {
    scale = getNextZoomStep(scale, 1);
    zoomMode = ZOOM_MODE.CUSTOM;
    updateZoomLabel();
    if (pdfViewer) { pdfViewer.scale = scale; const tab = getActiveTab(); if (tab) pdfViewer.renderAllPages(tab); }
  }

  function zoomOut() {
    scale = getNextZoomStep(scale, -1);
    zoomMode = ZOOM_MODE.CUSTOM;
    updateZoomLabel();
    if (pdfViewer) { pdfViewer.scale = scale; const tab = getActiveTab(); if (tab) pdfViewer.renderAllPages(tab); }
  }

  async function computeFitScale(tab, mode) {
    if (!tab || !tab.pdfDoc) return DEFAULT_SCALE;
    const page = await tab.pdfDoc.getPage(tab.currentPage);
    const baseViewport = page.getViewport({ scale: 1 });
    const featureMain = document.querySelector('.feature-main');
    if (!featureMain) return DEFAULT_SCALE;
    const style = window.getComputedStyle(featureMain);
    const paddingH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const paddingV = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availableWidth = featureMain.clientWidth - paddingH - 40;
    const availableHeight = featureMain.clientHeight - paddingV - 80;
    if (availableWidth <= 0 || availableHeight <= 0) return DEFAULT_SCALE;
    switch (mode) {
      case ZOOM_MODE.FIT_PAGE: return Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
      case ZOOM_MODE.FIT_HEIGHT: return availableHeight / baseViewport.height;
      case ZOOM_MODE.FIT_WIDTH: return availableWidth / baseViewport.width;
      case ZOOM_MODE.ACTUAL: return 1.0;
      default: return scale;
    }
  }

  async function applyFit(mode) {
    const tab = getActiveTab(); if (!tab) return;
    zoomMode = mode; scale = await computeFitScale(tab, mode); updateZoomLabel();
    if (statusBar) { statusBar.setZoom(scale); statusBar.updateZoomButtons(scale); }
    if (pdfViewer) { pdfViewer.scale = scale; pdfViewer.renderAllPages(tab); }
  }

  // ============================================================
  // Page Navigation Sidebar — uses shared thumbnail renderer
  // ============================================================
  function renderThumbnails(container) {
    if (typeof window.SmartPDF.renderThumbnails === 'function') {
      window.SmartPDF.renderThumbnails(pdfTabs, container);
    }
  }

  // ============================================================
  // Status Bar — uses shared StatusBar singleton
  // ============================================================
  function updateSidebarInfo(tab) {
    if (!tab) return;
    dom.infoFileName.textContent = tab.fileName;
    dom.infoPages.textContent = tab.totalPages;
    dom.infoCurrentPage.textContent = tab.currentPage + ' / ' + tab.totalPages;
    updateZoomLabel();
  }

  function resetSidebarInfo() {
    dom.infoFileName.textContent = '—'; dom.infoPages.textContent = '—';
    dom.infoCurrentPage.textContent = '—'; dom.infoZoom.textContent = '—';
    if (statusBar) { statusBar.hide(); statusBar.setFitEnabled(false); }
  }

  // ============================================================
  // Event Binding
  // ============================================================
  function bindEvents() {
    const featureMain = document.querySelector('.feature-main');
    featureMain.addEventListener('dragover', (e) => e.preventDefault());
    featureMain.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0 && pdfTabs) {
        for (const file of files) {
          if (file.name.endsWith('.pdf')) {
            if (pdfTabs.getTabCount() >= window.SmartPDF.MAX_TABS) { alert(`Maximum of ${window.SmartPDF.MAX_TABS} PDFs.`); break; }
            pdfTabs.openFileFromDrop(file);
          }
        }
      }
    });
    dom.pdfDropArea.addEventListener('click', openPdfDialog);
    dom.openPdfBtn.addEventListener('click', openPdfDialog);
    featureMain.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.deltaY < 0 ? zoomIn() : zoomOut(); }
    }, { passive: false });
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (!getActiveTab()) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomOut(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); applyFit(ZOOM_MODE.ACTUAL); }
    });
    dom.recentClear.addEventListener('click', clearRecentFiles);

    // Feature sidebar toggle
    const sidebarToggle = document.querySelector('.feature-sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        if (typeof window.SmartPDF.toggleFeatureSidebar === 'function') {
          window.SmartPDF.toggleFeatureSidebar();
        }
      });
    }
    window.addEventListener('resize', () => {
      const tab = getActiveTab(); if (!tab || !pdfViewer) return;
      if (zoomMode !== ZOOM_MODE.CUSTOM) applyFit(zoomMode);
    });
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    cacheDom();
    if (!dom.pdfPagesScroll) return;

    // Get shared PdfTabs singleton (created by main.js)
    pdfTabs = getPdfTabs();
    if (!pdfTabs) {
      console.error('[preview] Shared PdfTabs not available — retrying in 100ms');
      setTimeout(init, 100);
      return;
    }

    // Get shared StatusBar singleton
    statusBar = getStatusBar();

    loadRecentFiles();
    initPdfViewer();
    bindEvents();
    resetSidebarInfo();
    renderRecentFiles();

    // Override sharedPdfTabs.goToPage to delegate to pdfViewer
    const originalGoToPage = pdfTabs.goToPage.bind(pdfTabs);
    pdfTabs.goToPage = function(pageNum) {
      if (pdfViewer) return pdfViewer.goToPage(pageNum);
      return originalGoToPage(pageNum);
    };

    // Register the global zoom change handler for the status bar
    window.SmartPDF.onGlobalZoomChange = function(newScale, mode) {
      if (mode === 'custom') {
        scale = newScale;
        zoomMode = ZOOM_MODE.CUSTOM;
        updateZoomLabel();
        if (pdfViewer) { pdfViewer.scale = scale; const tab = getActiveTab(); if (tab) pdfViewer.renderAllPages(tab); }
      } else {
        // fit modes
        const modeMap = { fitPage: ZOOM_MODE.FIT_PAGE, fitHeight: ZOOM_MODE.FIT_HEIGHT, fitWidth: ZOOM_MODE.FIT_WIDTH, actual: ZOOM_MODE.ACTUAL };
        applyFit(modeMap[mode] || ZOOM_MODE.ACTUAL);
      }
    };

    // Register render callback with main.js
    if (typeof window.SmartPDF.setPageNav === 'function') {
      window.SmartPDF.setPageNav(() => {
        const tab = getActiveTab();
        if (tab && pdfViewer) {
          // If pages haven't been rendered yet (newly loaded PDF), render them
          if (pdfViewer.getPageWrappers().size === 0 && tab.pdfDoc) {
            onTabLoaded(tab);
          } else {
            pdfViewer.scrollToPage(tab.currentPage, true);
            updateSidebarInfo(tab);
          }
        }
      }, renderThumbnails);
    }

    // If a tab is already open from a previous feature, render it immediately
    const existingTab = getActiveTab();
    if (existingTab && existingTab.pdfDoc) {
      onTabLoaded(existingTab);
    }

    console.log('[preview] Initialized with shared PdfTabs singleton');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') { init(); }
  else { document.addEventListener('DOMContentLoaded', init); }
})();