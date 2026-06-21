// ============================================================
// SmartPDF - Compress Feature
// Uses the shared PdfTabs component for multi-file management.
// Compression engine: pdf-lib + pdfjs-dist rasterization.
// ============================================================

(function() {
  'use strict';

  const { ipcRenderer } = require('electron');
  const { Buffer } = require('buffer');
  const { PDFDocument } = require('pdf-lib');
  const pdfjsLib = require('pdfjs-dist');

  // ============================================================
  // State
  // ============================================================
  let pdfTabs = null;
  let scale = 1.5;
  let compressionProfile = 'balanced'; // 'balanced' | 'maximum' | 'lossless'
  let compressedBase64 = null;         // Result of last compression
  let isCompressing = false;

  // Profile settings
  const PROFILES = {
    balanced: {
      label: 'Balanced',
      renderScale: 0.55,
      targetRatio: 0.50,    // 50% reduction → result = 50% of original
      desc: 'Good quality · 50% smaller',
    },
    maximum: {
      label: 'Maximum',
      renderScale: 0.35,
      targetRatio: 0.25,    // 75% reduction → result = 25% of original
      desc: 'Smallest file · 75% smaller',
    },
    lossless: {
      label: 'Lossless',
      renderScale: null,
      targetRatio: 0.85,    // 15% reduction → result = 85% of original
      desc: 'Zero quality loss · 15% smaller',
    },
  };

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      pdfDropArea: document.getElementById('compress-pdfDropArea'),
      pdfPageContainer: document.getElementById('compress-pdfPageContainer'),
      pdfCanvas: document.getElementById('compress-pdf-canvas'),
      pageInfo: document.getElementById('compress-pageInfo'),
      pageInfoBottom: document.getElementById('compress-pageInfoBottom'),
      fileName: document.getElementById('compress-fileName'),
      openPdfBtn: document.getElementById('compress-openPdfBtn'),
      prevPageBtn: document.getElementById('compress-prevPageBtn'),
      nextPageBtn: document.getElementById('compress-nextPageBtn'),
      savePdfBtn: document.getElementById('compress-savePdfBtn'),
      compressBtn: document.getElementById('compress-compressBtn'),
      profileList: document.getElementById('compress-profileList'),
      originalSize: document.getElementById('compress-originalSize'),
      compressedSize: document.getElementById('compress-compressedSize'),
      savingsPercent: document.getElementById('compress-savingsPercent'),
      sizeBarInner: document.getElementById('compress-sizeBarInner'),
      progressOverlay: document.getElementById('compress-progressOverlay'),
      progressText: document.getElementById('compress-progressText'),
      progressFill: document.getElementById('compress-progressFill'),
      tabScroll: document.getElementById('compress-tabScroll'),
      tabBar: document.getElementById('compress-tabBar'),
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
      tabBarEl: dom.tabBar,
      tabScrollEl: dom.tabScroll,
      onTabSwitch: onTabSwitched,
      onTabClose: onTabClosed,
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
  }

  function onTabClosed(tabId) {
    if (pdfTabs && pdfTabs.getTabCount() === 0) {
      dom.pdfPageContainer.classList.add('hidden');
      dom.pdfDropArea.classList.remove('hidden');
      resetStats();
    }
  }

  function onDocumentLoaded(tab) {
    updateTabInfo(tab);
    updateStats(tab);
    updateCompressButton(tab);
  }

  function updateTabInfo(tab) {
    const info = `Page ${tab.currentPage} / ${tab.totalPages}`;
    dom.pageInfo.textContent = info;
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
  async function renderPreview(tab) {
    if (!tab || !tab.pdfDoc) return;

    const page = await tab.pdfDoc.getPage(tab.currentPage);
    const viewport = page.getViewport({ scale });

    const canvas = dom.pdfCanvas;
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;
    updateTabInfo(tab);
  }

  // ============================================================
  // Page Navigation
  // ============================================================
  function prevPage() {
    const tab = getActiveTab();
    if (tab && pdfTabs.prevPage()) {
      renderPreview(tab);
    }
  }

  function nextPage() {
    const tab = getActiveTab();
    if (tab && pdfTabs.nextPage()) {
      renderPreview(tab);
    }
  }

  // ============================================================
  // File Size Utilities
  // ============================================================
  function base64ToBytes(base64) {
    // Accurate: base64 encodes 3 bytes into 4 chars
    const padding = (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    return (base64.length * 3) / 4 - padding;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    return base64ToBytes(base64);
  }

  // ============================================================
  // Size Estimation & Stats
  // ============================================================
  function calculateEstimates(tab) {
    if (!tab || !tab.base64) return null;

    const originalBytes = base64ToBytes(tab.base64);
    const pageCount = tab.totalPages || 1;

    let estimatedBytes;
    if (compressionProfile === 'lossless') {
      // Lossless: 15% reduction → target 85% of original
      estimatedBytes = originalBytes * 0.85;
    } else if (compressionProfile === 'maximum') {
      // Maximum: 75% reduction → target 25% of original
      estimatedBytes = originalBytes * 0.25;
    } else {
      // Balanced: 50% reduction → target 50% of original
      estimatedBytes = originalBytes * 0.50;
    }

    // Clamp to reasonable minimum
    const minBytes = 1024; // 1 KB minimum
    estimatedBytes = Math.max(minBytes, estimatedBytes);

    const savingsPercent = Math.round((1 - estimatedBytes / originalBytes) * 100);

    return {
      originalBytes,
      estimatedBytes,
      savingsPercent,
    };
  }

  function updateStats(tab) {
    if (!tab || !tab.base64) return;

    const estimates = calculateEstimates(tab);
    if (!estimates) return;

    dom.originalSize.textContent = formatBytes(estimates.originalBytes);

    if (compressedBase64) {
      // Show actual compressed stats
      const actualBytes = base64ToBytes(compressedBase64);
      dom.compressedSize.textContent = formatBytes(actualBytes);
      const savings = Math.round((1 - actualBytes / estimates.originalBytes) * 100);
      dom.savingsPercent.textContent = savings + '% saved';
      dom.savingsPercent.style.color = savings > 5 ? '#34a853' : '#ea4335';

      // Update size bar
      const ratio = Math.max(0, Math.min(100, ((estimates.originalBytes - actualBytes) / estimates.originalBytes) * 100));
      dom.sizeBarInner.style.width = ratio + '%';
    } else {
      // Show estimated stats
      dom.compressedSize.textContent = '~' + formatBytes(estimates.estimatedBytes);
      dom.savingsPercent.textContent = '~' + estimates.savingsPercent + '% estimated';
      dom.savingsPercent.style.color = '#f9a825';

      dom.sizeBarInner.style.width = estimates.savingsPercent + '%';
    }
  }

  function resetStats() {
    dom.originalSize.textContent = '—';
    dom.compressedSize.textContent = '—';
    dom.savingsPercent.textContent = '—';
    dom.savingsPercent.style.color = '';
    dom.sizeBarInner.style.width = '0%';
    dom.compressBtn.disabled = true;
    dom.savePdfBtn.disabled = true;
    compressedBase64 = null;
  }

  // ============================================================
  // Compression Engine
  // ============================================================

  /**
   * Lossless compression: strips metadata and uses object streams.
   * Preserves all vector quality — no rasterization.
   */
  async function compressLossless(base64) {
    const pdfBytesLoad = Buffer.from(base64, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBytesLoad, {
      ignoreEncryption: true,
    });

    // Strip metadata
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('SmartPDF');
    pdfDoc.setCreator('SmartPDF');

    // Save with object stream compression
    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    return Buffer.from(pdfBytes).toString('base64');
  }

  /**
   * Render ALL pages once and return an array of canvas objects.
   * Each entry: { width, height, canvas } — the canvas holds the rendered page.
   * This is the expensive step (pdfjs rendering) — done only once.
   */
  async function renderAllCanvases(base64, renderScale) {
    const pdfBytesLoad = Buffer.from(base64, 'base64');
    const pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytesLoad }).promise;
    const pageCount = pdfJsDoc.numPages;
    const canvases = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfJsDoc.getPage(i);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      canvases.push({ width: viewport.width, height: viewport.height, canvas });
      updateProgress(i, pageCount);
    }

    pdfJsDoc.destroy();
    console.log(`[compress] Rendered ${pageCount} canvases`);
    return canvases;
  }

  /**
   * Sum the JPEG byte count of ALL canvases at a given quality.
   * canvas.toDataURL() re-encodes without re-rendering — very fast.
   */
  function sumJpegBytes(canvases, jpegQuality) {
    let total = 0;
    for (const item of canvases) {
      const dataUrl = item.canvas.toDataURL('image/jpeg', jpegQuality);
      const commaIndex = dataUrl.indexOf(',');
      const base64 = dataUrl.substring(commaIndex + 1);
      total += base64ToBytes(base64);
    }
    return total;
  }

  /**
   * Build a single-page PDF from the first canvas to measure actual PDF overhead.
   * Returns the difference: (full 1-page PDF bytes) − (JPEG bytes embedded).
   */
  async function measureOverhead(firstCanvas, jpegQuality) {
    const dataUrl = firstCanvas.canvas.toDataURL('image/jpeg', jpegQuality);
    const commaIndex = dataUrl.indexOf(',');
    const jpegBase64 = dataUrl.substring(commaIndex + 1);
    const jpegBytes = Buffer.from(jpegBase64, 'base64');

    const newPdf = await PDFDocument.create();
    let embeddedImage;
    try {
      embeddedImage = await newPdf.embedJpg(jpegBytes);
    } catch (embedErr) {
      const pngDataUrl = firstCanvas.canvas.toDataURL('image/png');
      const pngComma = pngDataUrl.indexOf(',');
      const pngBase64 = pngDataUrl.substring(pngComma + 1);
      embeddedImage = await newPdf.embedPng(Buffer.from(pngBase64, 'base64'));
    }

    const newPage = newPdf.addPage([firstCanvas.width, firstCanvas.height]);
    newPage.drawImage(embeddedImage, { x: 0, y: 0, width: firstCanvas.width, height: firstCanvas.height });

    const pdfBytes = await newPdf.save({ useObjectStreams: true });
    const overhead = pdfBytes.length - jpegBytes.length;
    console.log(`[compress] Measured overhead: ${overhead} bytes (PDF ${pdfBytes.length} − JPEG ${jpegBytes.length})`);
    return Math.max(0, overhead);
  }

  /**
   * Binary search JPEG quality using ALL canvases.
   * Each iteration sums JPEG bytes for every canvas → accurate total.
   * @returns {number} jpegQuality (0.05 – 1.0)
   */
  function findTargetQuality(canvases, perPageOverhead, targetBytes) {
    const pageCount = canvases.length;
    const totalOverhead = perPageOverhead * pageCount;
    const targetJpegTotal = Math.max(1, targetBytes - totalOverhead);

    console.log(`[compress] Calibrating: target=${formatBytes(targetBytes)}, targetJpeg=${formatBytes(targetJpegTotal)}, pages=${pageCount}, overhead=${perPageOverhead}B/page`);

    let lo = 0.05;
    let hi = 1.00;
    let bestQuality = 0.50;
    const maxIterations = 15;

    for (let iter = 0; iter < maxIterations; iter++) {
      const mid = (lo + hi) / 2;
      const jpegSum = sumJpegBytes(canvases, mid);

      if (Math.abs(jpegSum - targetJpegTotal) / targetJpegTotal < 0.02) {
        // Within 2% — close enough
        bestQuality = mid;
        break;
      }

      if (jpegSum > targetJpegTotal) {
        hi = mid;
      } else {
        lo = mid;
      }
      bestQuality = mid;
    }

    console.log(`[compress] Calibrated quality: ${bestQuality.toFixed(4)}`);
    return bestQuality;
  }

  /**
   * Build the final PDF from pre-rendered canvases at the given JPEG quality.
   * No pdfjs involved — just embed + pdf-lib save.
   */
  async function buildPdfFromCanvases(canvases, jpegQuality) {
    const newPdf = await PDFDocument.create();

    for (let i = 0; i < canvases.length; i++) {
      const item = canvases[i];
      const dataUrl = item.canvas.toDataURL('image/jpeg', jpegQuality);
      const commaIndex = dataUrl.indexOf(',');
      const jpegBase64 = dataUrl.substring(commaIndex + 1);
      const jpegBytes = Buffer.from(jpegBase64, 'base64');

      let embeddedImage;
      try {
        embeddedImage = await newPdf.embedJpg(jpegBytes);
      } catch (embedErr) {
        console.warn(`[compress] JPEG embed failed for page ${i + 1}, trying PNG`);
        const pngDataUrl = item.canvas.toDataURL('image/png');
        const pngComma = pngDataUrl.indexOf(',');
        const pngBase64 = pngDataUrl.substring(pngComma + 1);
        embeddedImage = await newPdf.embedPng(Buffer.from(pngBase64, 'base64'));
      }

      const newPage = newPdf.addPage([item.width, item.height]);
      newPage.drawImage(embeddedImage, { x: 0, y: 0, width: item.width, height: item.height });
    }

    const pdfBytes = await newPdf.save({ useObjectStreams: true });
    return Buffer.from(pdfBytes).toString('base64');
  }

  /**
   * Rasterized compression: render all canvases once,
   * calibrate JPEG quality from the full dataset,
   * build the PDF once, and correct if needed.
   */
  async function compressRasterized(base64, renderScale, targetRatio) {
    const originalBytes = base64ToBytes(base64);
    const targetBytes = originalBytes * targetRatio;
    const originalSizeStr = formatBytes(originalBytes);
    const targetSizeStr = formatBytes(targetBytes);
    console.log(`[compress] Target: ${originalSizeStr} → ${targetSizeStr} (${((1 - targetRatio) * 100).toFixed(0)}% reduction)`);

    // Step 1: Render ALL canvases once (expensive)
    showProgress('Rendering pages...', 5);
    const canvases = await renderAllCanvases(base64, renderScale);
    let jpegQuality = 0.50;

    // Step 2: Measure actual PDF overhead from the first canvas
    const perPageOverhead = await measureOverhead(canvases[0], 0.50);

    // Step 3: Calibrate JPEG quality from ALL canvases
    showProgress('Calibrating quality...', 30);
    jpegQuality = findTargetQuality(canvases, perPageOverhead, targetBytes);

    // Step 4: Build PDF
    showProgress('Building compressed PDF...', 50);
    let resultBase64 = await buildPdfFromCanvases(canvases, jpegQuality);
    let resultBytes = base64ToBytes(resultBase64);
    const actualRatio = resultBytes / originalBytes;
    const error = Math.abs(actualRatio - targetRatio) / targetRatio;

    console.log(`[compress] Pass 1: ${formatBytes(resultBytes)} (${(actualRatio * 100).toFixed(1)}% of original), error=${(error * 100).toFixed(1)}%`);

    // Step 5: Correction pass if off by more than 5%
    if (error > 0.05 && resultBytes > 0) {
      const correctedQuality = Math.max(0.05, Math.min(1.00, jpegQuality * (targetBytes / resultBytes)));
      console.log(`[compress] Correcting: Q=${jpegQuality.toFixed(4)} → Q=${correctedQuality.toFixed(4)}`);

      showProgress('Correcting compression...', 75);
      resultBase64 = await buildPdfFromCanvases(canvases, correctedQuality);
      resultBytes = base64ToBytes(resultBase64);
      jpegQuality = correctedQuality;

      const correctedRatio = resultBytes / originalBytes;
      const correctedError = Math.abs(correctedRatio - targetRatio) / targetRatio;
      console.log(`[compress] Pass 2: ${formatBytes(resultBytes)} (${(correctedRatio * 100).toFixed(1)}% of original), error=${(correctedError * 100).toFixed(1)}%`);
    }

    console.log(`[compress] Final: Q=${jpegQuality.toFixed(4)}, ${formatBytes(resultBytes)}`);
    return resultBase64;
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
    dom.progressText.textContent = `Processing page ${current} of ${total}...`;
    dom.progressFill.style.width = percent + '%';
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

    try {
      let resultBase64;

      if (compressionProfile === 'lossless') {
        showProgress('Optimizing PDF structure...', 30);
        resultBase64 = await compressLossless(tab.base64);
        showProgress('Optimization complete', 100);
      } else {
        const profile = PROFILES[compressionProfile];
        showProgress('Preparing compression...', 0);

        // Monkey-patch updateProgress so compressRasterized can call it
        // (it's in the same scope)
        resultBase64 = await compressRasterized(
          tab.base64,
          profile.renderScale,
          profile.targetRatio
        );

        showProgress('Compression complete', 100);
      }

      compressedBase64 = resultBase64;
      updateStats(tab);
      dom.savePdfBtn.disabled = false;

      const actualBytes = base64ToBytes(resultBase64);
      const originalBytes = base64ToBytes(tab.base64);
      const savings = Math.round((1 - actualBytes / originalBytes) * 100);

      console.log(`[compress] Profile: ${compressionProfile}`);
      console.log(`[compress] Original: ${formatBytes(originalBytes)} → Compressed: ${formatBytes(actualBytes)} (${savings}% saved)`);

      // Brief delay so user sees the 100% complete state
      setTimeout(hideProgress, 800);
    } catch (err) {
      console.error('[compress] Fatal error:', err);
      hideProgress();
      alert(`Compression failed: ${err.message}\n\nPlease open DevTools (Cmd+Opt+I) for detailed logs.`);
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

    // Update UI
    dom.profileList.querySelectorAll('.compress-profile-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.profile === profile);
    });

    // Reset compressed data since profile changed
    compressedBase64 = null;
    dom.savePdfBtn.disabled = true;

    // Re-estimate with new profile
    const tab = getActiveTab();
    if (tab) {
      updateStats(tab);
    }
  }

  // ============================================================
  // Event Binding
  // ============================================================
  function bindEvents() {
    // PDF drop zone
    const pdfViewer = document.querySelector('.feature-main');
    pdfViewer.addEventListener('dragover', (e) => e.preventDefault());
    pdfViewer.addEventListener('drop', (e) => {
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

    // Page navigation
    dom.prevPageBtn.addEventListener('click', prevPage);
    dom.nextPageBtn.addEventListener('click', nextPage);

    // Compress & Save buttons
    dom.compressBtn.addEventListener('click', compressPdf);
    dom.savePdfBtn.addEventListener('click', saveCompressedPdf);

    // Profile selection
    dom.profileList.addEventListener('click', (e) => {
      const card = e.target.closest('.compress-profile-card');
      if (card && card.dataset.profile) {
        selectProfile(card.dataset.profile);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        prevPage();
      } else if (e.key === 'ArrowRight') {
        nextPage();
      }
    });

    // Window resize
    window.addEventListener('resize', () => {
      const tab = getActiveTab();
      if (tab) {
        renderPreview(tab);
      }
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
    console.log('Compress feature initialized with shared PdfTabs');
  }

  if (!window.__featureInit) window.__featureInit = {};
  window.__featureInit.compress = init;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();