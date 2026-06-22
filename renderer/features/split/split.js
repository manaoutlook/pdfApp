// ============================================================
// SmartPDF - Split PDF Feature
// Drop zone to load a PDF, choose split mode, preview parts,
// and save all split parts to a folder.
// Uses the shared PdfTabs singleton and ContinuousPdfViewer.
// ============================================================

(function () {
  'use strict';

  const { ipcRenderer } = require('electron');
  const { Buffer } = require('buffer');
  const { PDFDocument } = require('pdf-lib');

  // ============================================================
  // State
  // ============================================================
  let pdfTabs = null;
  let pdfViewer = null;
  let scale = 1.5;
  let sourceBase64 = null;
  let sourceFileName = '';
  let sourceTotalPages = 0;
  let splitParts = [];       // { label, startPage, endPage, pageCount }
  let isSplitting = false;

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      dropArea:          document.getElementById('split-pdfDropArea'),
      dropTitle:         document.getElementById('split-dropTitle'),
      pdfPageContainer:  document.getElementById('split-pdfPageContainer'),
      pdfPagesScroll:    document.getElementById('split-pdfPagesScroll'),
      pageInfoBottom:    document.getElementById('split-pageInfoBottom'),
      fileName:          document.getElementById('split-fileName'),
      openPdfBtn:        document.getElementById('split-openPdfBtn'),
      // Sidebar info
      infoFileName:      document.getElementById('split-infoFileName'),
      infoPages:         document.getElementById('split-infoPages'),
      // Split mode
      everyNRadio:       document.querySelector('input[name="splitMode"][value="everyN"]'),
      rangesRadio:       document.querySelector('input[name="splitMode"][value="ranges"]'),
      eachPageRadio:     document.querySelector('input[name="splitMode"][value="eachPage"]'),
      everyNOptions:     document.getElementById('split-everyNOptions'),
      rangesOptions:     document.getElementById('split-rangesOptions'),
      pagesPerPart:      document.getElementById('split-pagesPerPart'),
      pageRangesInput:   document.getElementById('split-pageRanges'),
      // Preview
      previewSection:    document.getElementById('split-previewSection'),
      previewList:       document.getElementById('split-previewList'),
      previewTotalParts: document.getElementById('split-previewTotalParts'),
      // Action
      performSplitBtn:   document.getElementById('split-performSplitBtn'),
      // Progress
      progressOverlay:   document.getElementById('split-progressOverlay'),
      progressText:      document.getElementById('split-progressText'),
      progressFill:      document.getElementById('split-progressFill'),
    };
  }

  // ============================================================
  // Shared PdfTabs
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
    var ContinuousPdfViewer = window.SmartPDF.ContinuousPdfViewer;
    pdfViewer = new ContinuousPdfViewer({
      scrollContainerEl: dom.pdfPagesScroll,
      pdfTabs: pdfTabs,
      scale: scale,
      onPageChange: onPageChanged,
    });
  }

  function onPageChanged(pageNum, tab) {
    updatePreviewInfo(tab);
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function updatePreviewInfo(tab) {
    dom.pageInfoBottom.textContent = 'Page ' + tab.currentPage + ' / ' + tab.totalPages;
    dom.fileName.textContent = '📄 ' + tab.fileName;
  }

  // ============================================================
  // PDF Loading
  // ============================================================
  async function openPdfDialog() {
    if (!pdfTabs) return;
    var result = await ipcRenderer.invoke('split:open-pdf');
    if (!result) return;
    loadPdfData(result);
  }

  function handleDroppedFiles(fileList) {
    if (fileList.length === 0) return;
    var pdfFile = null;
    for (var i = 0; i < fileList.length; i++) {
      if (fileList[i].name.toLowerCase().endsWith('.pdf')) {
        pdfFile = fileList[i];
        break;
      }
    }
    if (!pdfFile) return;

    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      var base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
      loadPdfData({ filePath: pdfFile.path || pdfFile.name, data: base64 });
    };
    reader.readAsDataURL(pdfFile);
  }

  function loadPdfData(result) {
    sourceBase64 = result.data;
    sourceFileName = result.filePath.split(/[\\/]/).pop();

    // Load into PdfTabs for preview
    pdfTabs.openFiles([{ filePath: result.filePath, data: result.data }]);

    // Count pages using pdf-lib
    var pdfBytes = Buffer.from(result.data, 'base64');
    PDFDocument.load(pdfBytes, { ignoreEncryption: true }).then(function (pdfDoc) {
      sourceTotalPages = pdfDoc.getPageCount();
      updateSidebarInfo();
      updateSplitPreview();
      dom.performSplitBtn.disabled = false;
    }).catch(function (err) {
      console.warn('[split] Could not count pages:', err.message);
      sourceTotalPages = 0;
      updateSidebarInfo();
    });

    dom.pdfPageContainer.classList.remove('hidden');
    dom.dropArea.classList.add('hidden');
  }

  // ============================================================
  // Tab Loaded Callback
  // ============================================================
  function onTabLoaded(tab) {
    dom.pdfPageContainer.classList.remove('hidden');
    dom.dropArea.classList.add('hidden');
    updatePreviewInfo(tab);
    pdfViewer.renderAllPages(tab);
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function renderCurrentTab() {
    if (!pdfViewer) return;
    var tab = getActiveTab();
    if (!tab) {
      dom.pdfPageContainer.classList.add('hidden');
      dom.dropArea.classList.remove('hidden');
      return;
    }
    onTabLoaded(tab);
  }

  // ============================================================
  // Sidebar Info
  // ============================================================
  function updateSidebarInfo() {
    dom.infoFileName.textContent = sourceFileName || '—';
    dom.infoPages.textContent = sourceTotalPages > 0 ? sourceTotalPages : '—';
  }

  // ============================================================
  // Split Mode Switching
  // ============================================================
  function onSplitModeChange() {
    var mode = getSelectedSplitMode();
    dom.everyNOptions.classList.toggle('hidden', mode !== 'everyN');
    dom.rangesOptions.classList.toggle('hidden', mode !== 'ranges');
    updateSplitPreview();
  }

  function getSelectedSplitMode() {
    if (dom.everyNRadio && dom.everyNRadio.checked) return 'everyN';
    if (dom.rangesRadio && dom.rangesRadio.checked) return 'ranges';
    if (dom.eachPageRadio && dom.eachPageRadio.checked) return 'eachPage';
    return 'everyN';
  }

  // ============================================================
  // Split Preview Computation
  // ============================================================
  function computeSplitParts() {
    if (sourceTotalPages <= 0) return [];

    var mode = getSelectedSplitMode();
    var parts = [];

    switch (mode) {
      case 'everyN': {
        var n = parseInt(dom.pagesPerPart.value, 10) || 1;
        if (n < 1) n = 1;
        for (var start = 1; start <= sourceTotalPages; start += n) {
          var end = Math.min(start + n - 1, sourceTotalPages);
          parts.push({ label: 'Part ' + (parts.length + 1), startPage: start, endPage: end, pageCount: end - start + 1 });
        }
        break;
      }
      case 'ranges': {
        var raw = dom.pageRangesInput.value.trim();
        if (!raw) break;
        var rangeParts = raw.split(',').map(function (s) { return s.trim(); });
        for (var r = 0; r < rangeParts.length; r++) {
          var range = rangeParts[r];
          var match = range.match(/^(\d+)\s*-\s*(\d+)$/);
          if (match) {
            var startR = parseInt(match[1], 10);
            var endR = parseInt(match[2], 10);
            if (startR >= 1 && endR <= sourceTotalPages && startR <= endR) {
              parts.push({ label: 'Part ' + (parts.length + 1), startPage: startR, endPage: endR, pageCount: endR - startR + 1 });
            }
          }
        }
        break;
      }
      case 'eachPage': {
        for (var p = 1; p <= sourceTotalPages; p++) {
          parts.push({ label: 'Page ' + p, startPage: p, endPage: p, pageCount: 1 });
        }
        break;
      }
    }

    return parts;
  }

  function updateSplitPreview() {
    splitParts = computeSplitParts();

    if (splitParts.length === 0 || sourceTotalPages <= 0) {
      dom.previewSection.classList.add('hidden');
      return;
    }

    dom.previewSection.classList.remove('hidden');
    dom.previewList.innerHTML = '';

    splitParts.forEach(function (part, i) {
      var el = document.createElement('div');
      el.className = 'split-preview-item';

      var iconSpan = document.createElement('span');
      iconSpan.className = 'split-preview-item-icon';
      iconSpan.textContent = '📄';
      el.appendChild(iconSpan);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'split-preview-item-name';
      nameSpan.textContent = part.label;
      el.appendChild(nameSpan);

      var pagesSpan = document.createElement('span');
      pagesSpan.className = 'split-preview-item-pages';
      pagesSpan.textContent = 'p' + part.startPage + '-' + part.endPage + ' (' + part.pageCount + ' pg)';
      el.appendChild(pagesSpan);

      dom.previewList.appendChild(el);
    });

    dom.previewTotalParts.textContent = splitParts.length + ' part' + (splitParts.length !== 1 ? 's' : '');
    dom.performSplitBtn.disabled = splitParts.length < 1;
  }

  // ============================================================
  // Split Engine
  // ============================================================
  async function performSplit() {
    if (isSplitting || !sourceBase64 || splitParts.length === 0) return;
    isSplitting = true;
    dom.performSplitBtn.disabled = true;

    try {
      showProgress('Loading PDF...', 5);

      var pdfBytes = Buffer.from(sourceBase64, 'base64');
      var sourceDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

      var baseName = sourceFileName.replace(/\.pdf$/i, '') || 'split';

      showProgress('Choosing save folder...', 15);

      // Ask user for output folder
      var outputDir = await ipcRenderer.invoke('split:choose-folder');
      if (!outputDir) {
        hideProgress();
        isSplitting = false;
        dom.performSplitBtn.disabled = false;
        return;
      }

      showProgress('Splitting PDF...', 30);

      for (var i = 0; i < splitParts.length; i++) {
        var part = splitParts[i];
        var progress = 30 + Math.round((i + 1) / splitParts.length * 55);
        showProgress('Creating part ' + (i + 1) + ' of ' + splitParts.length + '...', progress);

        var newDoc = await PDFDocument.create();
        var pageIndices = [];
        for (var p = part.startPage - 1; p < part.endPage; p++) {
          pageIndices.push(p);
        }
        var copiedPages = await newDoc.copyPages(sourceDoc, pageIndices);
        copiedPages.forEach(function (page) {
          newDoc.addPage(page);
        });
        var newBytes = await newDoc.save({ useObjectStreams: true });
        var partBase64 = Buffer.from(newBytes).toString('base64');

        // Determine file name for this part
        var partFileName = baseName + '_part' + (i + 1) + '.pdf';

        // Save this part
        await ipcRenderer.invoke('split:save-part', {
          base64: partBase64,
          fileName: partFileName,
          outputDir: outputDir,
        });
      }

      showProgress('Done!', 100);
      console.log('[split] ' + splitParts.length + ' parts created for ' + sourceFileName);

      setTimeout(hideProgress, 800);

    } catch (err) {
      console.error('[split]', err);
      hideProgress();
      if (typeof window.SmartPDF.showErrorToast === 'function') {
        window.SmartPDF.showErrorToast('Split failed: ' + err.message);
      } else {
        alert('Split failed: ' + err.message);
      }
    } finally {
      isSplitting = false;
      dom.performSplitBtn.disabled = false;
    }
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

  // ============================================================
  // Page Thumbnails
  // ============================================================
  function renderThumbnails(container) {
    if (typeof window.SmartPDF.renderThumbnails === 'function') {
      window.SmartPDF.renderThumbnails(pdfTabs, container);
    }
  }

  // ============================================================
  // Event Binding
  // ============================================================
  function bindEvents() {
    var featureMain = document.querySelector('.feature-main');

    // Drag-and-drop onto the feature
    featureMain.addEventListener('dragover', function (e) { e.preventDefault(); });
    featureMain.addEventListener('drop', function (e) {
      e.preventDefault();
      handleDroppedFiles(e.dataTransfer.files);
    });

    // Click on drop zone or Open PDF button
    dom.dropArea.addEventListener('click', function (e) {
      if (e.target === dom.openPdfBtn || dom.openPdfBtn.contains(e.target)) return;
      openPdfDialog();
    });
    dom.openPdfBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openPdfDialog();
    });

    // Split mode radio buttons
    var modeRadios = document.querySelectorAll('input[name="splitMode"]');
    modeRadios.forEach(function (radio) {
      radio.addEventListener('change', onSplitModeChange);
    });

    // Pages per part input
    dom.pagesPerPart.addEventListener('input', updateSplitPreview);

    // Page ranges input
    dom.pageRangesInput.addEventListener('input', updateSplitPreview);

    // Perform split
    dom.performSplitBtn.addEventListener('click', performSplit);

    // Sidebar toggle
    var sidebarToggle = document.querySelector('.feature-sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
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
    cacheDom();
    if (!dom.pdfPagesScroll) return;

    pdfTabs = getPdfTabs();
    if (!pdfTabs) {
      console.error('[split] Shared PdfTabs not available — retrying in 100ms');
      setTimeout(init, 100);
      return;
    }

    initPdfViewer();
    bindEvents();
    updateSidebarInfo();

    // Override goToPage
    var originalGoToPage = pdfTabs.goToPage.bind(pdfTabs);
    pdfTabs.goToPage = function (pageNum) {
      if (pdfViewer) return pdfViewer.goToPage(pageNum);
      return originalGoToPage(pageNum);
    };

    // Register render callback
    if (typeof window.SmartPDF.setPageNav === 'function') {
      window.SmartPDF.setPageNav(function () {
        var tab = getActiveTab();
        if (tab && pdfViewer) {
          if (pdfViewer.getPageWrappers().size === 0 && tab.pdfDoc) {
            onTabLoaded(tab);
          } else {
            pdfViewer.scrollToPage(tab.currentPage, true);
          }
        }
      }, renderThumbnails);
    }

    // Wire shared status bar
    var sb = window.SmartPDF && window.SmartPDF.sharedStatusBar ? window.SmartPDF.sharedStatusBar : null;
    if (sb) {
      sb.onPrevPage = function () {
        if (pdfViewer && pdfViewer.prevPage()) {
          var t = getActiveTab(); if (t) updatePreviewInfo(t);
        }
      };
      sb.onNextPage = function () {
        if (pdfViewer && pdfViewer.nextPage()) {
          var t = getActiveTab(); if (t) updatePreviewInfo(t);
        }
      };
    }

    var existingTab = getActiveTab();
    if (existingTab && existingTab.pdfDoc) {
      onTabLoaded(existingTab);
      // Recalculate from the existing tab data
      if (existingTab.base64) {
        sourceBase64 = existingTab.base64;
        sourceFileName = existingTab.fileName;
        var pdfBytes = Buffer.from(sourceBase64, 'base64');
        PDFDocument.load(pdfBytes, { ignoreEncryption: true }).then(function (pdfDoc) {
          sourceTotalPages = pdfDoc.getPageCount();
          updateSidebarInfo();
          updateSplitPreview();
          dom.performSplitBtn.disabled = false;
        }).catch(function () {});
      }
    }

    console.log('[split] Initialized — drop zone always visible');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();