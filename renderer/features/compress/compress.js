// ============================================================
// SmartPDF - Compress Feature
// Uses the shared PdfTabs singleton and ContinuousPdfViewer.
// PDFs persist across features via the global tab bar.
//
// Compression engine: pdfjs-dist (rasterization) + pdf-lib (rebuild).
//
// Profiles:
//   balanced  — 150 DPI, JPEG 0.78  → good quality, noticeably smaller
//   maximum   — 96 DPI,  JPEG 0.50  → smallest file, visible quality loss
//   lossless  — NO rasterization     → strips metadata/XMP only
//   custom    — user-chosen DPI,     → full control via slider
//               JPEG 0.75 (fixed)
// ============================================================

(function () {
  'use strict';

  const { ipcRenderer } = require('electron');
  const { Buffer } = require('buffer');
  const { PDFDocument } = require('pdf-lib');
  const pdfjsLib = require('pdfjs-dist');

  // ============================================================
  // Profile Definitions
  // ============================================================
  const PROFILES = {
    balanced: {
      label: 'Balanced', dpi: 150, get renderScale() { return this.dpi / 72; }, jpegQuality: 0.78,
      desc: '150 DPI · Good quality, noticeably smaller',
    },
    maximum: {
      label: 'Maximum', dpi: 96, get renderScale() { return this.dpi / 72; }, jpegQuality: 0.50,
      desc: '96 DPI · Smallest file, visible quality loss',
    },
    lossless: {
      label: 'Lossless', dpi: null, renderScale: null, jpegQuality: null,
      desc: 'Original DPI · Strips metadata, no pixel changes',
    },
    custom: {
      label: 'Custom DPI', dpi: 150, get renderScale() { return this.dpi / 72; }, jpegQuality: 0.75,
      desc: 'User-defined DPI',
    },
  };

  // ============================================================
  // State
  // ============================================================
  let pdfTabs = null;           // Shared singleton
  let pdfViewer = null;         // ContinuousPdfViewer instance
  let scale = 1.5;
  let compressionProfile = 'balanced';
  let compressedBase64 = null;
  let isCompressing = false;
  let customDpi = 150;

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      pdfDropArea:       document.getElementById('compress-pdfDropArea'),
      pdfPageContainer:  document.getElementById('compress-pdfPageContainer'),
      pdfPagesScroll:    document.getElementById('compress-pdfPagesScroll'),
      pageInfoBottom:    document.getElementById('compress-pageInfoBottom'),
      fileName:          document.getElementById('compress-fileName'),
      openPdfBtn:        document.getElementById('compress-openPdfBtn'),
      savePdfBtn:        document.getElementById('compress-savePdfBtn'),
      compressBtn:       document.getElementById('compress-compressBtn'),
      profileList:       document.getElementById('compress-profileList'),
      originalSize:      document.getElementById('compress-originalSize'),
      compressedSize:    document.getElementById('compress-compressedSize'),
      savingsPercent:    document.getElementById('compress-savingsPercent'),
      sizeBarInner:      document.getElementById('compress-sizeBarInner'),
      progressOverlay:   document.getElementById('compress-progressOverlay'),
      progressText:      document.getElementById('compress-progressText'),
      progressFill:      document.getElementById('compress-progressFill'),
      // DPI slider
      dpiPanel:          document.getElementById('compress-dpiPanel'),
      dpiSlider:         document.getElementById('compress-dpiSlider'),
      dpiValueLabel:     document.getElementById('compress-dpiValueLabel'),
      dpiHint:           document.getElementById('compress-dpiHint'),
      customDpiBadge:    document.getElementById('compress-customDpiBadge'),
      dpiStatRow:        document.getElementById('compress-dpiStatRow'),
      dpiUsed:           document.getElementById('compress-dpiUsed'),
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
  // Continuous Pdf Viewer Integration
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
    updateStats(tab);
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function onTabLoaded(tab) {
    dom.pdfPageContainer.classList.remove('hidden');
    dom.pdfDropArea.classList.add('hidden');
    updateTabInfo(tab);
    updateStats(tab);
    updateCompressButton(tab);
    pdfViewer.renderAllPages(tab);
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function renderCurrentTab() {
    if (!pdfViewer) return;
    const tab = getActiveTab();
    if (!tab) {
      dom.pdfPageContainer.classList.add('hidden');
      dom.pdfDropArea.classList.remove('hidden');
      resetStats();
      return;
    }
    onTabLoaded(tab);
  }

  function updateTabInfo(tab) {
    dom.pageInfoBottom.textContent = `Page ${tab.currentPage} / ${tab.totalPages}`;
    dom.fileName.textContent = `📄 ${tab.fileName}`;
    dom.compressBtn.disabled = false;
  }

  function updateCompressButton(tab) {
    if (tab && tab.base64) dom.compressBtn.disabled = false;
  }

  // ============================================================
  // PDF Loading
  // ============================================================
  async function openPdfDialog() {
    const result = await ipcRenderer.invoke('compress:open-pdf');
    if (!result || !pdfTabs) return;
    if (!Array.isArray(result)) {
      pdfTabs.openFiles([{ filePath: result.filePath, data: result.data }]);
      return;
    }
    pdfTabs.openFiles(result);
  }

  // ============================================================
  // Page Thumbnails — uses shared thumbnail renderer
  // ============================================================
  function renderThumbnails(container) {
    if (typeof window.SmartPDF.renderThumbnails === 'function') {
      window.SmartPDF.renderThumbnails(pdfTabs, container);
    }
  }

  // ============================================================
  // File Size Utilities
  // ============================================================
  function base64ToBytes(base64) { const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0; return (base64.length * 3) / 4 - padding; }
  function formatBytes(bytes) { if (bytes === 0) return '0 B'; if (bytes < 1024) return bytes + ' B'; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'; return (bytes / (1024 * 1024)).toFixed(2) + ' MB'; }
  function getDpiHint(dpi) { if (dpi <= 72) return 'Draft quality — screen only'; if (dpi <= 96) return 'Similar to Maximum compression'; if (dpi <= 130) return 'Moderate quality, good for email'; if (dpi <= 160) return 'Similar to Balanced compression'; if (dpi <= 200) return 'High quality — everyday sharing'; if (dpi <= 250) return 'Very high quality — near original'; return 'Print quality — minimal size reduction'; }

  // ============================================================
  // Stats Display
  // ============================================================
  function updateStats(tab) {
    if (!tab || !tab.base64) return;
    const originalBytes = base64ToBytes(tab.base64);
    dom.originalSize.textContent = formatBytes(originalBytes);
    if (compressedBase64) {
      const actualBytes = base64ToBytes(compressedBase64);
      const savings = Math.round((1 - actualBytes / originalBytes) * 100);
      dom.compressedSize.textContent = formatBytes(actualBytes);
      dom.savingsPercent.textContent = savings > 0 ? `${savings}% saved` : savings === 0 ? 'No change' : `${Math.abs(savings)}% larger`;
      dom.savingsPercent.style.color = savings > 5 ? '#34a853' : savings < 0 ? '#ea4335' : '#f9a825';
      dom.sizeBarInner.style.width = Math.max(0, Math.min(100, savings)) + '%';
      const profile = PROFILES[compressionProfile];
      if (profile.dpi !== null) { dom.dpiStatRow.style.display = ''; dom.dpiUsed.textContent = profile.dpi + ' DPI'; } else dom.dpiStatRow.style.display = 'none';
    } else {
      dom.compressedSize.textContent = '—'; dom.savingsPercent.textContent = 'Run compress to see results'; dom.savingsPercent.style.color = '#888';
      dom.sizeBarInner.style.width = '0%'; dom.dpiStatRow.style.display = 'none';
    }
  }

  function resetStats() {
    dom.originalSize.textContent = '—'; dom.compressedSize.textContent = '—'; dom.savingsPercent.textContent = '—'; dom.savingsPercent.style.color = '';
    dom.sizeBarInner.style.width = '0%'; dom.dpiStatRow.style.display = 'none'; dom.compressBtn.disabled = true; dom.savePdfBtn.disabled = true;
    compressedBase64 = null;
  }

  // ============================================================
  // Progress UI
  // ============================================================
  function showProgress(text, percent) { dom.progressOverlay.classList.remove('hidden'); dom.progressText.textContent = text; dom.progressFill.style.width = percent + '%'; }
  function hideProgress() { dom.progressOverlay.classList.add('hidden'); dom.progressFill.style.width = '0%'; }
  function updateProgress(current, total) { const percent = Math.round((current / total) * 100); dom.progressText.textContent = `Rendering page ${current} of ${total}...`; dom.progressFill.style.width = percent + '%'; }

  // ============================================================
  // Compression Engine — Lossless
  // ============================================================
  async function compressLossless(base64) {
    const pdfBytes = Buffer.from(base64, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    pdfDoc.setTitle(''); pdfDoc.setAuthor(''); pdfDoc.setSubject(''); pdfDoc.setKeywords([]); pdfDoc.setProducer('SmartPDF'); pdfDoc.setCreator('SmartPDF');
    const optimized = await pdfDoc.save({ useObjectStreams: true });
    return Buffer.from(optimized).toString('base64');
  }

  // ============================================================
  // Compression Engine — Rasterized
  // ============================================================
  async function compressRasterized(base64, dpi, jpegQuality) {
    const renderScale = dpi / 72;
    const pdfBytesLoad = Buffer.from(base64, 'base64');
    const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytesLoad }).promise;
    const pageCount = pdfJsDoc.numPages;
    const MAX_CANVAS_DIM = 16384;
    showProgress('Rendering pages...', 5);
    const canvases = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfJsDoc.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      let pageScale = renderScale;
      const maxDim = Math.max(baseViewport.width, baseViewport.height) * renderScale;
      if (maxDim > MAX_CANVAS_DIM) pageScale = renderScale * (MAX_CANVAS_DIM / maxDim);
      const viewport = page.getViewport({ scale: pageScale });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      canvases.push({ width: baseViewport.width, height: baseViewport.height, canvas });
      updateProgress(i, pageCount);
    }
    pdfJsDoc.destroy();
    showProgress('Building compressed PDF...', 70);
    const newPdf = await PDFDocument.create();
    for (let i = 0; i < canvases.length; i++) {
      const item = canvases[i];
      const dataUrl = item.canvas.toDataURL('image/jpeg', jpegQuality);
      const jpegBase64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
      if (!jpegBase64) throw new Error(`Page ${i + 1} could not be encoded — try a lower DPI.`);
      let embeddedImage;
      try { embeddedImage = await newPdf.embedJpg(Buffer.from(jpegBase64, 'base64')); } catch (embedErr) {
        const pngDataUrl = item.canvas.toDataURL('image/png'); const pngBase64 = pngDataUrl.substring(pngDataUrl.indexOf(',') + 1);
        if (!pngBase64) throw new Error(`Page ${i + 1} could not be encoded — try a lower DPI.`);
        embeddedImage = await newPdf.embedPng(Buffer.from(pngBase64, 'base64'));
      }
      const newPage = newPdf.addPage([item.width, item.height]);
      newPage.drawImage(embeddedImage, { x: 0, y: 0, width: item.width, height: item.height });
      showProgress(`Assembling page ${i + 1} of ${canvases.length}...`, Math.round(70 + ((i + 1) / canvases.length) * 28));
    }
    const pdfBytes = await newPdf.save({ useObjectStreams: true });
    return Buffer.from(pdfBytes).toString('base64');
  }

  // ============================================================
  // Main Compress Action
  // ============================================================
  async function compressPdf() {
    const tab = getActiveTab(); if (!tab || !tab.base64 || isCompressing) return;
    isCompressing = true; dom.compressBtn.disabled = true; compressedBase64 = null;
    const profile = PROFILES[compressionProfile];
    if (compressionProfile === 'custom') profile.dpi = customDpi;
    try {
      let resultBase64;
      if (compressionProfile === 'lossless') { showProgress('Optimizing PDF structure...', 20); resultBase64 = await compressLossless(tab.base64); showProgress('Done', 100); }
      else { showProgress('Preparing...', 0); resultBase64 = await compressRasterized(tab.base64, profile.dpi, profile.jpegQuality); showProgress('Done', 100); }
      compressedBase64 = resultBase64; updateStats(tab); dom.savePdfBtn.disabled = false;
      console.log(`[compress] ${formatBytes(base64ToBytes(tab.base64))} → ${formatBytes(base64ToBytes(resultBase64))}`);
      setTimeout(hideProgress, 800);
    } catch (err) { console.error('[compress]', err); hideProgress(); alert(`Compression failed: ${err.message}`); compressedBase64 = null; resetStats(); }
    finally { isCompressing = false; if (tab && tab.base64) dom.compressBtn.disabled = false; }
  }

  async function saveCompressedPdf() {
    const tab = getActiveTab(); if (!tab || !compressedBase64) { alert('Please compress first.'); return; }
    const saved = await ipcRenderer.invoke('compress:save-pdf', compressedBase64);
    if (saved) { pdfTabs.updateTabData(tab.id, compressedBase64); pdfTabs.setTabDirty(tab.id, false); }
  }

  function selectProfile(profile) {
    compressionProfile = profile;
    dom.profileList.querySelectorAll('.compress-profile-card').forEach(card => card.classList.toggle('selected', card.dataset.profile === profile));
    if (profile === 'custom') dom.dpiPanel.classList.remove('hidden'); else dom.dpiPanel.classList.add('hidden');
    compressedBase64 = null; dom.savePdfBtn.disabled = true;
    const tab = getActiveTab(); if (tab) updateStats(tab);
  }

  function onDpiSliderInput() {
    const dpi = parseInt(dom.dpiSlider.value, 10); customDpi = dpi; PROFILES.custom.dpi = dpi;
    dom.dpiValueLabel.textContent = dpi + ' DPI'; dom.customDpiBadge.textContent = dpi + ' DPI'; dom.dpiHint.textContent = getDpiHint(dpi);
    if (compressedBase64) { compressedBase64 = null; dom.savePdfBtn.disabled = true; const tab = getActiveTab(); if (tab) updateStats(tab); }
  }

  // ============================================================
  // Event Binding
  // ============================================================
  function bindEvents() {
    const featureMain = document.querySelector('.feature-main');
    featureMain.addEventListener('dragover', (e) => e.preventDefault());
    featureMain.addEventListener('drop', (e) => { e.preventDefault(); const files = e.dataTransfer.files; if (files.length > 0 && pdfTabs) { for (const file of files) { if (file.name.endsWith('.pdf')) { if (pdfTabs.getTabCount() >= window.SmartPDF.MAX_TABS) { alert(`Maximum of ${window.SmartPDF.MAX_TABS} PDFs.`); break; } pdfTabs.openFileFromDrop(file); } } } });
    dom.pdfDropArea.addEventListener('click', openPdfDialog); dom.openPdfBtn.addEventListener('click', openPdfDialog);
    dom.compressBtn.addEventListener('click', compressPdf); dom.savePdfBtn.addEventListener('click', saveCompressedPdf);
    dom.profileList.addEventListener('click', (e) => { const card = e.target.closest('.compress-profile-card'); if (card && card.dataset.profile) selectProfile(card.dataset.profile); });
    dom.dpiSlider.addEventListener('input', onDpiSliderInput);

    // Feature sidebar toggle
    var sidebarToggle = document.querySelector('.feature-sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function() {
        if (typeof window.SmartPDF.toggleFeatureSidebar === 'function') {
          window.SmartPDF.toggleFeatureSidebar();
        }
      });
    }
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    cacheDom(); if (!dom.pdfPagesScroll) return;

    pdfTabs = getPdfTabs();
    if (!pdfTabs) { console.error('[compress] Shared PdfTabs not available — retrying in 100ms'); setTimeout(init, 100); return; }

    initPdfViewer(); bindEvents(); resetStats();

    // Override goToPage
    const originalGoToPage = pdfTabs.goToPage.bind(pdfTabs);
    pdfTabs.goToPage = function(pageNum) { if (pdfViewer) return pdfViewer.goToPage(pageNum); return originalGoToPage(pageNum); };

    // Register render callback
    if (typeof window.SmartPDF.setPageNav === 'function') {
      window.SmartPDF.setPageNav(() => {
        const tab = getActiveTab();
        if (tab && pdfViewer) {
          if (pdfViewer.getPageWrappers().size === 0 && tab.pdfDoc) {
            onTabLoaded(tab);
          } else {
            pdfViewer.scrollToPage(tab.currentPage, true);
            updateStats(tab);
          }
        }
      }, renderThumbnails);
    }

    // If a tab is already open from a previous feature, render immediately
    const existingTab = getActiveTab(); if (existingTab && existingTab.pdfDoc) onTabLoaded(existingTab);

    // Wire shared status bar prev/next
    const sb = window.SmartPDF && window.SmartPDF.sharedStatusBar ? window.SmartPDF.sharedStatusBar : null;
    if (sb) {
      sb.onPrevPage = () => { if (pdfViewer && pdfViewer.prevPage()) { const t = getActiveTab(); if (t) updateTabInfo(t); } };
      sb.onNextPage = () => { if (pdfViewer && pdfViewer.nextPage()) { const t = getActiveTab(); if (t) updateTabInfo(t); } };
    }

    onDpiSliderInput();
    console.log('[compress] Initialized with shared PdfTabs singleton');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') { init(); }
  else { document.addEventListener('DOMContentLoaded', init); }
})();