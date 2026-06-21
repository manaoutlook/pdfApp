// ============================================================
// SmartPDF - Compress Feature
// Uses the shared PdfTabs component for multi-file management.
//
// Compression engine: pdfjs-dist (rasterization) + pdf-lib (rebuild).
//
// KEY DESIGN PRINCIPLE:
//   DPI drives quality — not an arbitrary file-size ratio.
//   renderScale = targetDPI / 72  (72 is PDF's base resolution unit)
//
// Profiles:
//   balanced  — 150 DPI, JPEG 0.78  → good quality, noticeably smaller
//   maximum   — 96 DPI,  JPEG 0.50  → smallest file, visible quality loss
//   lossless  — NO rasterization     → strips metadata/XMP only, exact pixels
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

  // PDF base resolution is 72 "user units" per inch.
  // renderScale = desiredDPI / 72
  // A higher DPI → larger canvas → sharper image → bigger file.
  const PROFILES = {
    balanced: {
      label: 'Balanced',
      dpi: 150,
      get renderScale() { return this.dpi / 72; },
      jpegQuality: 0.78,
      desc: '150 DPI · Good quality, noticeably smaller',
    },
    maximum: {
      label: 'Maximum',
      dpi: 96,
      get renderScale() { return this.dpi / 72; },
      jpegQuality: 0.50,
      desc: '96 DPI · Smallest file, visible quality loss',
    },
    lossless: {
      label: 'Lossless',
      dpi: null,          // No rasterization
      renderScale: null,
      jpegQuality: null,
      desc: 'Original DPI · Strips metadata, no pixel changes',
    },
    custom: {
      label: 'Custom DPI',
      dpi: 150,           // Updated live by the slider
      get renderScale() { return this.dpi / 72; },
      jpegQuality: 0.75,
      desc: 'User-defined DPI',
    },
  };

  // ============================================================
  // State
  // ============================================================
  let pdfTabs = null;
  let scale = 1.5;                        // Preview render scale
  let compressionProfile = 'balanced';
  let compressedBase64 = null;
  let isCompressing = false;
  let customDpi = 150;                    // Tracks current custom DPI value

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      pdfDropArea:       document.getElementById('compress-pdfDropArea'),
      pdfPageContainer:  document.getElementById('compress-pdfPageContainer'),
      pdfCanvas:         document.getElementById('compress-pdf-canvas'),
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
      tabScroll:         document.getElementById('compress-tabScroll'),
      tabBar:            document.getElementById('compress-tabBar'),
      // DPI slider controls
      dpiPanel:          document.getElementById('compress-dpiPanel'),
      dpiSlider:         document.getElementById('compress-dpiSlider'),
      dpiValueLabel:     document.getElementById('compress-dpiValueLabel'),
      dpiHint:           document.getElementById('compress-dpiHint'),
      customDpiBadge:    document.getElementById('compress-customDpiBadge'),
      // DPI stat row
      dpiStatRow:        document.getElementById('compress-dpiStatRow'),
      dpiUsed:           document.getElementById('compress-dpiUsed'),
    };
  }

  // ============================================================
  // PdfTabs Integration
  // ============================================================

  function initPdfTabs() {
    if (!window.SmartPDF || !window.SmartPDF.PdfTabs) {
      console.error('PdfTabs component not available');
      return;
    }

    const PdfTabs = window.SmartPDF.PdfTabs;

    pdfTabs = new PdfTabs({
      tabBarEl:       dom.tabBar,
      tabScrollEl:    dom.tabScroll,
      onTabSwitch:    onTabSwitched,
      onTabClose:     onTabClosed,
      onDocumentLoad: onDocumentLoaded,
    });
  }

  function getActiveTab() {
    return pdfTabs ? pdfTabs.getActiveTab() : null;
  }

  function onTabSwitched(tab) {
    if (!tab) return;
    dom.pdfPageContainer.classList.remove('hidden');
    dom.pdfDropArea.classList.add('hidden');
    updateTabInfo(tab);
    renderPreview(tab);
    updateStats(tab);
    updateCompressButton(tab);
    // Sync the global page navigation sidebar
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function onTabClosed(tabId) {
    if (pdfTabs && pdfTabs.getTabCount() === 0) {
      dom.pdfPageContainer.classList.add('hidden');
      dom.pdfDropArea.classList.remove('hidden');
      resetStats();
    }
    // Sync the global page navigation sidebar
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function onDocumentLoaded(tab) {
    updateTabInfo(tab);
    updateStats(tab);
    updateCompressButton(tab);
    // Sync the global page navigation sidebar
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function updateTabInfo(tab) {
    const info = `Page ${tab.currentPage} / ${tab.totalPages}`;
    dom.pageInfoBottom.textContent = info;
    dom.fileName.textContent = `📄 ${tab.fileName}`;
    dom.compressBtn.disabled = false;
  }

  function updateCompressButton(tab) {
    if (tab && tab.base64) {
      dom.compressBtn.disabled = false;
    }
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

  function loadPdfFromFile(file) {
    if (!pdfTabs) return;
    if (pdfTabs.getTabCount() >= window.SmartPDF.MAX_TABS) {
      alert(`Maximum of ${window.SmartPDF.MAX_TABS} PDFs can be open at once.`);
      return;
    }
    pdfTabs.openFileFromDrop(file);
  }

  // ============================================================
  // Page Rendering (Preview)
  // ============================================================
  let previewRenderTask = null;

  async function renderPreview(tab) {
    if (!tab || !tab.pdfDoc) return;

    // Cancel any in-flight render on the shared preview canvas. Without this,
    // a resize / tab-switch / page-nav firing mid-render makes pdf.js throw
    // "Cannot use the same canvas during multiple render() operations".
    if (previewRenderTask) {
      try { previewRenderTask.cancel(); } catch (e) { /* ignore */ }
      previewRenderTask = null;
    }

    const page = await tab.pdfDoc.getPage(tab.currentPage);
    const viewport = page.getViewport({ scale });

    const canvas = dom.pdfCanvas;
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    try {
      previewRenderTask = page.render({ canvasContext: context, viewport });
      await previewRenderTask.promise;
      previewRenderTask = null;
      updateTabInfo(tab);
    } catch (err) {
      // RenderingCancelledException is expected when we cancel above — ignore it.
      if (err && err.name !== 'RenderingCancelledException') {
        console.error('[compress] Preview render failed:', err);
      }
    }
  }

  // ============================================================
  // Page Thumbnails (for sidebar)
  // ============================================================
  function renderThumbnails(container) {
    const tab = getActiveTab();
    if (!tab || !tab.pdfDoc) return;

    const totalPages = tab.totalPages;
    const activePage = tab.currentPage;

    for (let i = 1; i <= totalPages; i++) {
      const item = document.createElement('div');
      item.className = 'page-nav-thumb-item' + (i === activePage ? ' active' : '');
      item.dataset.page = i;

      const canvas = document.createElement('canvas');
      canvas.className = 'page-nav-thumb-canvas';
      canvas.width = 160;
      canvas.height = 200;
      item.appendChild(canvas);

      const label = document.createElement('div');
      label.className = 'page-nav-thumb-label';
      label.textContent = `Page ${i}`;
      item.appendChild(label);

      container.appendChild(item);

      // Render thumbnail asynchronously
      renderThumbnailPage(tab, i, canvas);
    }
  }

  async function renderThumbnailPage(tab, pageNum, canvas) {
    try {
      const page = await tab.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.15 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (err) {
      // Silently ignore thumbnail render errors
    }
  }

  // ============================================================
  // File Size Utilities
  // ============================================================
  function base64ToBytes(base64) {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return (base64.length * 3) / 4 - padding;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  // ============================================================
  // DPI Hint Text
  // ============================================================
  function getDpiHint(dpi) {
    if (dpi <= 72)  return 'Draft quality — screen only';
    if (dpi <= 96)  return 'Similar to Maximum compression';
    if (dpi <= 130) return 'Moderate quality, good for email';
    if (dpi <= 160) return 'Similar to Balanced compression';
    if (dpi <= 200) return 'High quality — everyday sharing';
    if (dpi <= 250) return 'Very high quality — near original';
    return 'Print quality — minimal size reduction';
  }

  // ============================================================
  // Stats Display
  // ============================================================
  function updateStats(tab) {
    if (!tab || !tab.base64) return;

    const originalBytes = base64ToBytes(tab.base64);
    dom.originalSize.textContent = formatBytes(originalBytes);

    if (compressedBase64) {
      // Show actual results after compression
      const actualBytes = base64ToBytes(compressedBase64);
      const savings = Math.round((1 - actualBytes / originalBytes) * 100);

      dom.compressedSize.textContent = formatBytes(actualBytes);
      dom.savingsPercent.textContent = savings > 0
        ? `${savings}% saved`
        : savings === 0
          ? 'No change'
          : `${Math.abs(savings)}% larger`;
      dom.savingsPercent.style.color = savings > 5
        ? '#34a853'
        : savings < 0
          ? '#ea4335'
          : '#f9a825';

      const barRatio = Math.max(0, Math.min(100, savings));
      dom.sizeBarInner.style.width = barRatio + '%';

      // Show DPI stat row only for rasterized profiles
      const profile = PROFILES[compressionProfile];
      if (profile.dpi !== null) {
        dom.dpiStatRow.style.display = '';
        dom.dpiUsed.textContent = profile.dpi + ' DPI';
      } else {
        dom.dpiStatRow.style.display = 'none';
      }
    } else {
      // No compression done yet — show placeholder
      dom.compressedSize.textContent = '—';
      dom.savingsPercent.textContent = 'Run compress to see results';
      dom.savingsPercent.style.color = '#888';
      dom.sizeBarInner.style.width = '0%';
      dom.dpiStatRow.style.display = 'none';
    }
  }

  function resetStats() {
    dom.originalSize.textContent = '—';
    dom.compressedSize.textContent = '—';
    dom.savingsPercent.textContent = '—';
    dom.savingsPercent.style.color = '';
    dom.sizeBarInner.style.width = '0%';
    dom.dpiStatRow.style.display = 'none';
    dom.compressBtn.disabled = true;
    dom.savePdfBtn.disabled = true;
    compressedBase64 = null;
  }

  // ============================================================
  // Progress UI
  // ============================================================
  function showProgress(text, percent) {
    dom.progressOverlay.classList.remove('hidden');
    dom.progressText.textContent = text;
    dom.progressFill.style.width = percent + '%';
  }

  function hideProgress() {
    dom.progressOverlay.classList.add('hidden');
    dom.progressFill.style.width = '0%';
  }

  function updateProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    dom.progressText.textContent = `Rendering page ${current} of ${total}...`;
    dom.progressFill.style.width = percent + '%';
  }

  // ============================================================
  // Compression Engine — Lossless
  //
  // Strips metadata and re-saves with object streams.
  // NEVER rasterizes — every pixel is preserved exactly.
  // ============================================================
  async function compressLossless(base64) {
    const pdfBytes = Buffer.from(base64, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    // Strip all metadata fields
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('SmartPDF');
    pdfDoc.setCreator('SmartPDF');

    // Save with object stream compression (Flate/ZIP)
    const optimized = await pdfDoc.save({ useObjectStreams: true });
    return Buffer.from(optimized).toString('base64');
  }

  // ============================================================
  // Compression Engine — Rasterized (Balanced / Maximum / Custom)
  //
  //  1. Render each page at renderScale (= dpi/72) using pdfjs
  //  2. Encode each page as JPEG at jpegQuality
  //  3. Embed all pages into a new pdf-lib document
  //
  // No binary search. No target ratio. DPI IS the quality control.
  // ============================================================
  async function compressRasterized(base64, dpi, jpegQuality) {
    const renderScale = dpi / 72;

    console.log(`[compress] Rasterizing at ${dpi} DPI (scale=${renderScale.toFixed(3)}), JPEG Q=${jpegQuality}`);

    const pdfBytesLoad = Buffer.from(base64, 'base64');
    const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytesLoad }).promise;
    const pageCount = pdfJsDoc.numPages;

    // Chromium hard-limits a canvas to 16384px per side (and ~268M px area).
    // If a page at the requested DPI would exceed that, toDataURL() silently
    // returns an empty string, which later surfaces as a bogus embed error.
    // We clamp the *bitmap* resolution per page but never touch page size.
    const MAX_CANVAS_DIM = 16384;

    // Step 1: Render all pages at target DPI
    showProgress('Rendering pages...', 5);
    const canvases = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfJsDoc.getPage(i);

      // The page's ORIGINAL size in PDF points (scale = 1). This is the
      // physical size the rebuilt page must keep — DPI only controls how
      // many pixels we render into it, NOT how big the page is.
      const baseViewport = page.getViewport({ scale: 1 });

      // Clamp render scale so neither canvas dimension exceeds the limit.
      let pageScale = renderScale;
      const maxDim = Math.max(baseViewport.width, baseViewport.height) * renderScale;
      if (maxDim > MAX_CANVAS_DIM) {
        pageScale = renderScale * (MAX_CANVAS_DIM / maxDim);
        console.warn(`[compress] Page ${i} clamped: ${renderScale.toFixed(2)} → ${pageScale.toFixed(2)} to stay under ${MAX_CANVAS_DIM}px`);
      }

      const viewport = page.getViewport({ scale: pageScale });
      const canvas = document.createElement('canvas');
      canvas.width  = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Store the ORIGINAL point dimensions for the rebuilt page.
      canvases.push({ width: baseViewport.width, height: baseViewport.height, canvas });
      updateProgress(i, pageCount);
    }
    pdfJsDoc.destroy();
    console.log(`[compress] Rendered ${pageCount} pages at ${dpi} DPI`);

    // Step 2: Encode pages as JPEG and assemble into a new PDF
    showProgress('Building compressed PDF...', 70);
    const newPdf = await PDFDocument.create();

    for (let i = 0; i < canvases.length; i++) {
      const item = canvases[i];
      const dataUrl = item.canvas.toDataURL('image/jpeg', jpegQuality);
      const jpegBase64 = dataUrl.substring(dataUrl.indexOf(',') + 1);

      // An empty payload means the canvas could not be encoded (almost always
      // an oversized canvas). Fail loudly with an actionable message rather
      // than letting the downstream embed throw a misleading "not a PNG" error.
      if (!jpegBase64) {
        throw new Error(`Page ${i + 1} could not be encoded — the page may be too large at this DPI. Try a lower DPI.`);
      }

      let embeddedImage;
      try {
        embeddedImage = await newPdf.embedJpg(Buffer.from(jpegBase64, 'base64'));
      } catch (embedErr) {
        // Fallback to PNG if JPEG embedding fails (e.g., grayscale edge case)
        console.warn(`[compress] JPEG embed failed for page ${i + 1}, trying PNG`);
        const pngDataUrl = item.canvas.toDataURL('image/png');
        const pngBase64 = pngDataUrl.substring(pngDataUrl.indexOf(',') + 1);
        if (!pngBase64) {
          throw new Error(`Page ${i + 1} could not be encoded — the page may be too large at this DPI. Try a lower DPI.`);
        }
        embeddedImage = await newPdf.embedPng(Buffer.from(pngBase64, 'base64'));
      }

      const newPage = newPdf.addPage([item.width, item.height]);
      newPage.drawImage(embeddedImage, { x: 0, y: 0, width: item.width, height: item.height });

      const pct = Math.round(70 + ((i + 1) / canvases.length) * 28);
      showProgress(`Assembling page ${i + 1} of ${canvases.length}...`, pct);
    }

    const pdfBytes = await newPdf.save({ useObjectStreams: true });
    return Buffer.from(pdfBytes).toString('base64');
  }

  // ============================================================
  // Main Compress Action
  // ============================================================
  async function compressPdf() {
    const tab = getActiveTab();
    if (!tab || !tab.base64 || isCompressing) return;

    isCompressing = true;
    dom.compressBtn.disabled = true;
    compressedBase64 = null;

    const profile = PROFILES[compressionProfile];

    // Sync custom DPI into the custom profile before compressing
    if (compressionProfile === 'custom') {
      profile.dpi = customDpi;
    }

    try {
      let resultBase64;

      if (compressionProfile === 'lossless') {
        showProgress('Optimizing PDF structure...', 20);
        resultBase64 = await compressLossless(tab.base64);
        showProgress('Done', 100);

      } else {
        showProgress('Preparing...', 0);
        resultBase64 = await compressRasterized(
          tab.base64,
          profile.dpi,
          profile.jpegQuality
        );
        showProgress('Done', 100);
      }

      compressedBase64 = resultBase64;
      updateStats(tab);
      dom.savePdfBtn.disabled = false;

      const originalBytes = base64ToBytes(tab.base64);
      const actualBytes   = base64ToBytes(resultBase64);
      const savings       = Math.round((1 - actualBytes / originalBytes) * 100);

      console.log(`[compress] Profile: ${compressionProfile}${profile.dpi ? ' @ ' + profile.dpi + ' DPI' : ''}`);
      console.log(`[compress] ${formatBytes(originalBytes)} → ${formatBytes(actualBytes)} (${savings}% saved)`);

      setTimeout(hideProgress, 800);

    } catch (err) {
      console.error('[compress] Fatal error:', err);
      hideProgress();
      const msg = (err && err.message) || (err && err.toString && err.toString()) || String(err);
      const devToolsShortcut = window.SmartPDF && window.SmartPDF.getDevToolsShortcut
        ? window.SmartPDF.getDevToolsShortcut()
        : 'Cmd+Opt+I';
      alert(`Compression failed: ${msg}\n\nPlease open DevTools (${devToolsShortcut}) for detailed logs.`);
      compressedBase64 = null;
      resetStats();
    } finally {
      isCompressing = false;
      if (tab && tab.base64) {
        dom.compressBtn.disabled = false;
      }
    }
  }

  // ============================================================
  // Save Compressed PDF
  // ============================================================
  async function saveCompressedPdf() {
    const tab = getActiveTab();
    if (!tab || !compressedBase64) {
      alert('Please compress the PDF first before saving.');
      return;
    }

    const saved = await ipcRenderer.invoke('compress:save-pdf', compressedBase64);
    if (saved) {
      pdfTabs.updateTabData(tab.id, compressedBase64);
      pdfTabs.setTabDirty(tab.id, false);
      console.log('[compress] Compressed PDF saved successfully');
    } else {
      console.log('[compress] Save cancelled by user');
    }
  }

  // ============================================================
  // Profile Selection
  // ============================================================
  function selectProfile(profile) {
    compressionProfile = profile;

    // Update profile card highlight
    dom.profileList.querySelectorAll('.compress-profile-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.profile === profile);
    });

    // Show / hide the Custom DPI panel
    if (profile === 'custom') {
      dom.dpiPanel.classList.remove('hidden');
    } else {
      dom.dpiPanel.classList.add('hidden');
    }

    // Reset previous compression result since profile changed
    compressedBase64 = null;
    dom.savePdfBtn.disabled = true;

    // Refresh stats (clears compressed size, updates original)
    const tab = getActiveTab();
    if (tab) {
      updateStats(tab);
    }
  }

  // ============================================================
  // Custom DPI Slider
  // ============================================================
  function onDpiSliderInput() {
    const dpi = parseInt(dom.dpiSlider.value, 10);
    customDpi = dpi;
    PROFILES.custom.dpi = dpi;

    // Update labels
    dom.dpiValueLabel.textContent = dpi + ' DPI';
    dom.customDpiBadge.textContent = dpi + ' DPI';
    dom.dpiHint.textContent = getDpiHint(dpi);

    // If a previous compression result exists, invalidate it
    if (compressedBase64) {
      compressedBase64 = null;
      dom.savePdfBtn.disabled = true;
      const tab = getActiveTab();
      if (tab) updateStats(tab);
    }
  }

  // ============================================================
  // Event Binding
  // ============================================================
  function bindEvents() {
    // Drag-and-drop onto the main area
    const featureMain = document.querySelector('.feature-main');
    featureMain.addEventListener('dragover', (e) => e.preventDefault());
    featureMain.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0 && pdfTabs) {
        for (const file of files) {
          if (file.name.endsWith('.pdf')) {
            if (pdfTabs.getTabCount() >= window.SmartPDF.MAX_TABS) {
              alert(`Maximum of ${window.SmartPDF.MAX_TABS} PDFs can be open at once.`);
              break;
            }
            pdfTabs.openFileFromDrop(file);
          }
        }
      }
    });

    dom.pdfDropArea.addEventListener('click', openPdfDialog);
    dom.openPdfBtn.addEventListener('click', openPdfDialog);

    // Page navigation is handled by the global sidebar via window.SmartPDF.setPageNav

    // Compress & Save
    dom.compressBtn.addEventListener('click', compressPdf);
    dom.savePdfBtn.addEventListener('click', saveCompressedPdf);

    // Profile card clicks
    dom.profileList.addEventListener('click', (e) => {
      const card = e.target.closest('.compress-profile-card');
      if (card && card.dataset.profile) {
        selectProfile(card.dataset.profile);
      }
    });

    // DPI slider
    dom.dpiSlider.addEventListener('input', onDpiSliderInput);

    // Keyboard page navigation is handled globally by main.js

    // Re-render preview on resize
    window.addEventListener('resize', () => {
      const tab = getActiveTab();
      if (tab) renderPreview(tab);
    });
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    cacheDom();
    if (!dom.pdfCanvas) return;

    initPdfTabs();
    bindEvents();
    resetStats();

    // Register with global page navigation sidebar
    if (typeof window.SmartPDF.setPageNav === 'function') {
      window.SmartPDF.setPageNav(pdfTabs, () => {
        const tab = getActiveTab();
        if (tab) renderPreview(tab);
      }, renderThumbnails);
    }

    // Initialise custom DPI slider display
    onDpiSliderInput();

    console.log('[compress] Initialized — DPI-based compression engine ready');
    console.log('[compress] Profiles: balanced (150 DPI), maximum (96 DPI), lossless (no rasterize), custom (slider)');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
