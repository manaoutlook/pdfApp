// ============================================================
// SmartPDF - Convert From PDF Feature
// Drop zone to load a PDF, choose output format, convert and save.
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
  let isConverting = false;

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      dropArea:          document.getElementById('convert-pdfDropArea'),
      dropTitle:         document.getElementById('convert-dropTitle'),
      pdfPageContainer:  document.getElementById('convert-pdfPageContainer'),
      pdfPagesScroll:    document.getElementById('convert-pdfPagesScroll'),
      pageInfoBottom:    document.getElementById('convert-pageInfoBottom'),
      fileName:          document.getElementById('convert-fileName'),
      openPdfBtn:        document.getElementById('convert-openPdfBtn'),
      // Sidebar info
      infoFileName:      document.getElementById('convert-infoFileName'),
      infoPages:         document.getElementById('convert-infoPages'),
      // Format selection
      formatGrid:        document.getElementById('convert-formatGrid'),
      formatCards:       document.querySelectorAll('.convert-format-card'),
      formatRadios:      document.querySelectorAll('input[name="convertFormat"]'),
      // Image options
      imageOptions:      document.getElementById('convert-imageOptions'),
      imageQuality:      document.getElementById('convert-imageQuality'),
      imageQualityValue: document.getElementById('convert-imageQualityValue'),
      // Preview
      previewSection:    document.getElementById('convert-previewSection'),
      previewInfo:       document.getElementById('convert-previewInfo'),
      previewText:       document.getElementById('convert-previewText'),
      // Action
      performBtn:        document.getElementById('convert-performBtn'),
      // Progress
      progressOverlay:   document.getElementById('convert-progressOverlay'),
      progressText:      document.getElementById('convert-progressText'),
      progressFill:      document.getElementById('convert-progressFill'),
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
    var result = await ipcRenderer.invoke('convert:open-pdf');
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
      updateConvertPreview();
      dom.performBtn.disabled = false;
    }).catch(function (err) {
      console.warn('[convert] Could not count pages:', err.message);
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
  // Format Selection
  // ============================================================
  function getSelectedFormat() {
    for (var i = 0; i < dom.formatRadios.length; i++) {
      if (dom.formatRadios[i].checked) return dom.formatRadios[i].value;
    }
    return 'docx';
  }

  function onFormatChange(format) {
    // Update visual selection
    dom.formatCards.forEach(function (card) {
      card.classList.toggle('selected', card.dataset.format === format);
    });

    // Show/hide image options
    var isImage = format === 'png' || format === 'jpeg';
    dom.imageOptions.classList.toggle('hidden', !isImage);

    updateConvertPreview();
  }

  function onImageQualityChange() {
    var val = dom.imageQuality.value;
    dom.imageQualityValue.textContent = val + '%';
  }

  // ============================================================
  // Convert Preview
  // ============================================================
  function updateConvertPreview() {
    if (sourceTotalPages <= 0) {
      dom.previewSection.classList.add('hidden');
      return;
    }

    var format = getSelectedFormat();
    var previewText = '';
    var isBatch = false;

    switch (format) {
      case 'docx':
        previewText = '📝 Convert ' + sourceFileName + ' → Word document (.docx)';
        break;
      case 'xlsx':
        previewText = '📊 Convert ' + sourceFileName + ' → Excel workbook (.xlsx)';
        break;
      case 'png':
        previewText = '🖼️ Convert ' + sourceTotalPages + ' page' + (sourceTotalPages !== 1 ? 's' : '') + ' → PNG images';
        isBatch = sourceTotalPages > 1;
        break;
      case 'jpeg':
        previewText = '🖼️ Convert ' + sourceTotalPages + ' page' + (sourceTotalPages !== 1 ? 's' : '') + ' → JPEG images';
        isBatch = sourceTotalPages > 1;
        break;
      case 'txt':
        previewText = '📄 Convert ' + sourceFileName + ' → Text file (.txt)';
        break;
      case 'csv':
        previewText = '📋 Convert ' + sourceFileName + ' → CSV file' + (sourceTotalPages > 1 ? 's (per page)' : '');
        isBatch = sourceTotalPages > 1;
        break;
      case 'html':
        previewText = '🌐 Convert ' + sourceFileName + ' → HTML document (.html)';
        break;
    }

    dom.previewSection.classList.remove('hidden');
    dom.previewText.textContent = previewText;
  }

  // ============================================================
  // Convert Engine
  // ============================================================
  async function performConvert() {
    if (isConverting || !sourceBase64) return;
    isConverting = true;
    dom.performBtn.disabled = true;

    try {
      var format = getSelectedFormat();

      showProgress('Extracting PDF content...', 10);

      switch (format) {
        case 'docx':
          await convertToDocx();
          break;
        case 'xlsx':
          await convertToXlsx();
          break;
        case 'png':
        case 'jpeg':
          await convertToImages(format);
          break;
        case 'txt':
          await convertToTxt();
          break;
        case 'csv':
          await convertToCsv();
          break;
        case 'html':
          await convertToHtml();
          break;
      }

      showProgress('Done!', 100);
      setTimeout(hideProgress, 800);

    } catch (err) {
      console.error('[convert]', err);
      hideProgress();
      if (typeof window.SmartPDF.showErrorToast === 'function') {
        window.SmartPDF.showErrorToast('Conversion failed: ' + err.message);
      } else {
        alert('Conversion failed: ' + err.message);
      }
    } finally {
      isConverting = false;
      dom.performBtn.disabled = false;
    }
  }

  async function convertToDocx() {
    showProgress('Converting to Word format...', 30);

    var result = await ipcRenderer.invoke('convert:to-docx', {
      base64: sourceBase64,
      fileName: sourceFileName,
    });

    if (!result.success) throw new Error(result.error || 'DOCX conversion failed');

    showProgress('Saving DOCX file...', 80);

    var filePath = await ipcRenderer.invoke('convert:save-dialog', {
      defaultName: result.data.fileName,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });

    if (filePath) {
      var buffer = Buffer.from(result.data.base64, 'base64');
      // Use save-file IPC to write to chosen path
      var dir = filePath.substring(0, filePath.lastIndexOf('\\'));
      var name = filePath.substring(filePath.lastIndexOf('\\') + 1);
      await ipcRenderer.invoke('convert:save-file', {
        base64: result.data.base64,
        fileName: name,
        outputDir: dir,
      });
    }
  }

  async function convertToXlsx() {
    showProgress('Converting to Excel format...', 30);

    var result = await ipcRenderer.invoke('convert:to-xlsx', {
      base64: sourceBase64,
      fileName: sourceFileName,
    });

    if (!result.success) throw new Error(result.error || 'XLSX conversion failed');

    showProgress('Saving XLSX file...', 80);

    var filePath = await ipcRenderer.invoke('convert:save-dialog', {
      defaultName: result.data.fileName,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });

    if (filePath) {
      var dir = filePath.substring(0, filePath.lastIndexOf('\\'));
      var name = filePath.substring(filePath.lastIndexOf('\\') + 1);
      await ipcRenderer.invoke('convert:save-file', {
        base64: result.data.base64,
        fileName: name,
        outputDir: dir,
      });
    }
  }

  async function convertToImages(format) {
    var quality = parseInt(dom.imageQuality.value, 10) || 85;

    showProgress('Rendering pages to ' + format.toUpperCase() + '...', 20);

    var result = await ipcRenderer.invoke('convert:to-images', {
      base64: sourceBase64,
      fileName: sourceFileName,
      format: format,
      quality: quality,
    });

    if (!result.success) throw new Error(result.error || 'Image conversion failed');

    var images = result.data.images;

    if (images.length === 1) {
      // Single image: use save dialog
      showProgress('Saving image...', 80);

      var ext = format === 'jpeg' ? 'jpg' : 'png';
      var filePath = await ipcRenderer.invoke('convert:save-dialog', {
        defaultName: images[0].fileName,
        filters: [{ name: format.toUpperCase() + ' Image', extensions: [ext] }],
      });

      if (filePath) {
        var dir = filePath.substring(0, filePath.lastIndexOf('\\'));
        var name = filePath.substring(filePath.lastIndexOf('\\') + 1);
        await ipcRenderer.invoke('convert:save-file', {
          base64: images[0].base64,
          fileName: name,
          outputDir: dir,
        });
      }
    } else {
      // Multiple images: choose a folder
      showProgress('Choosing save folder...', 70);

      var outputDir = await ipcRenderer.invoke('convert:choose-folder');
      if (!outputDir) {
        hideProgress();
        isConverting = false;
        dom.performBtn.disabled = false;
        return;
      }

      for (var i = 0; i < images.length; i++) {
        var pct = 70 + Math.round((i + 1) / images.length * 25);
        showProgress('Saving image ' + (i + 1) + ' of ' + images.length + '...', pct);

        await ipcRenderer.invoke('convert:save-file', {
          base64: images[i].base64,
          fileName: images[i].fileName,
          outputDir: outputDir,
        });
      }
    }
  }

  async function convertToTxt() {
    showProgress('Extracting text...', 30);

    var result = await ipcRenderer.invoke('convert:to-txt', {
      base64: sourceBase64,
      fileName: sourceFileName,
    });

    if (!result.success) throw new Error(result.error || 'Text extraction failed');

    showProgress('Saving TXT file...', 80);

    var filePath = await ipcRenderer.invoke('convert:save-dialog', {
      defaultName: result.data.fileName,
      filters: [{ name: 'Text File', extensions: ['txt'] }],
    });

    if (filePath) {
      var dir = filePath.substring(0, filePath.lastIndexOf('\\'));
      var name = filePath.substring(filePath.lastIndexOf('\\') + 1);
      await ipcRenderer.invoke('convert:save-file', {
        base64: result.data.base64,
        fileName: name,
        outputDir: dir,
      });
    }
  }

  async function convertToCsv() {
    showProgress('Extracting tables...', 30);

    var result = await ipcRenderer.invoke('convert:to-csv', {
      base64: sourceBase64,
      fileName: sourceFileName,
    });

    if (!result.success) throw new Error(result.error || 'CSV conversion failed');

    var files = result.data.files;

    if (files.length === 1) {
      showProgress('Saving CSV file...', 80);

      var filePath = await ipcRenderer.invoke('convert:save-dialog', {
        defaultName: files[0].fileName,
        filters: [{ name: 'CSV File', extensions: ['csv'] }],
      });

      if (filePath) {
        var dir = filePath.substring(0, filePath.lastIndexOf('\\'));
        var name = filePath.substring(filePath.lastIndexOf('\\') + 1);
        var csvBase64 = Buffer.from(files[0].data, 'utf-8').toString('base64');
        await ipcRenderer.invoke('convert:save-file', {
          base64: csvBase64,
          fileName: name,
          outputDir: dir,
        });
      }
    } else {
      showProgress('Choosing save folder...', 70);

      var outputDir = await ipcRenderer.invoke('convert:choose-folder');
      if (!outputDir) {
        hideProgress();
        isConverting = false;
        dom.performBtn.disabled = false;
        return;
      }

      for (var i = 0; i < files.length; i++) {
        var pct = 70 + Math.round((i + 1) / files.length * 25);
        showProgress('Saving CSV ' + (i + 1) + ' of ' + files.length + '...', pct);
        var csvBase64 = Buffer.from(files[i].data, 'utf-8').toString('base64');
        await ipcRenderer.invoke('convert:save-file', {
          base64: csvBase64,
          fileName: files[i].fileName,
          outputDir: outputDir,
        });
      }
    }
  }

  async function convertToHtml() {
    showProgress('Converting to HTML...', 30);

    var result = await ipcRenderer.invoke('convert:to-html', {
      base64: sourceBase64,
      fileName: sourceFileName,
    });

    if (!result.success) throw new Error(result.error || 'HTML conversion failed');

    showProgress('Saving HTML file...', 80);

    var filePath = await ipcRenderer.invoke('convert:save-dialog', {
      defaultName: result.data.fileName,
      filters: [{ name: 'HTML File', extensions: ['html'] }],
    });

    if (filePath) {
      var dir = filePath.substring(0, filePath.lastIndexOf('\\'));
      var name = filePath.substring(filePath.lastIndexOf('\\') + 1);
      await ipcRenderer.invoke('convert:save-file', {
        base64: result.data.base64,
        fileName: name,
        outputDir: dir,
      });
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

    // Format card selection
    dom.formatGrid.addEventListener('click', function (e) {
      var card = e.target.closest('.convert-format-card');
      if (!card) return;

      var format = card.dataset.format;
      var radio = card.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        onFormatChange(format);
      }
    });

    // Image quality slider
    dom.imageQuality.addEventListener('input', onImageQualityChange);

    // Perform convert
    dom.performBtn.addEventListener('click', performConvert);

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
      console.error('[convert] Shared PdfTabs not available — retrying in 100ms');
      setTimeout(init, 100);
      return;
    }

    initPdfViewer();
    bindEvents();
    updateSidebarInfo();

    // Initialize format selection
    onFormatChange('docx');

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
          updateConvertPreview();
          dom.performBtn.disabled = false;
        }).catch(function () {});
      }
    }

    console.log('[convert] Initialized — drop zone always visible');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();