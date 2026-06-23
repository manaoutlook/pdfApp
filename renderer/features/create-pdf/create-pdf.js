// ============================================================
// SmartPDF - Create PDF (Convert To PDF) Feature
// Drop zone to load DOCX, XLSX, Images, TXT, HTML, CSV files
// and convert them into PDF documents.
// ============================================================

(function () {
  'use strict';

  const { ipcRenderer } = require('electron');
  const { Buffer } = require('buffer');

  // ============================================================
  // State
  // ============================================================
  let sourceBase64 = null;
  let sourceFileName = '';
  let sourceFilePath = '';
  let sourceFileType = '';
  let sourceFileSize = 0;
  let imageBatches = []; // [{ base64, fileName }] for multi-image mode
  let isCreating = false;

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      dropArea:          document.getElementById('createpdf-pdfDropArea'),
      dropTitle:         document.getElementById('createpdf-dropTitle'),
      openFileBtn:       document.getElementById('createpdf-openFileBtn'),
      infoArea:          document.getElementById('createpdf-infoArea'),
      fileIcon:          document.getElementById('createpdf-fileIcon'),
      fileName:          document.getElementById('createpdf-fileName'),
      fileType:          document.getElementById('createpdf-fileType'),
      fileSize:          document.getElementById('createpdf-fileSize'),
      changeFileBtn:     document.getElementById('createpdf-changeFileBtn'),
      previewSection:    document.getElementById('createpdf-previewSection'),
      previewContent:    document.getElementById('createpdf-previewContent'),
      // Sidebar
      infoFileName:      document.getElementById('createpdf-infoFileName'),
      infoFormat:        document.getElementById('createpdf-infoFormat'),
      infoSize:          document.getElementById('createpdf-infoSize'),
      infoPages:         document.getElementById('createpdf-infoPages'),
      // Options
      pageSize:          document.getElementById('createpdf-pageSize'),
      orientation:       document.getElementById('createpdf-orientation'),
      margin:            document.getElementById('createpdf-margin'),
      batchOption:       document.getElementById('createpdf-batchOption'),
      addImagesBtn:      document.getElementById('createpdf-addImagesBtn'),
      // Summary / Action
      summary:           document.getElementById('createpdf-summary'),
      summaryText:       document.getElementById('createpdf-summaryText'),
      performBtn:        document.getElementById('createpdf-performBtn'),
      // Progress
      progressOverlay:   document.getElementById('createpdf-progressOverlay'),
      progressText:      document.getElementById('createpdf-progressText'),
      progressFill:      document.getElementById('createpdf-progressFill'),
    };
  }

  // ============================================================
  // File Type Info
  // ============================================================
  const fileTypeMap = {
    docx:  { icon: '📝', name: 'Word Document', ext: '.docx' },
    xlsx:  { icon: '📊', name: 'Excel Workbook', ext: '.xlsx' },
    image: { icon: '🖼️', name: 'Image', ext: '' },
    txt:   { icon: '📄', name: 'Text File', ext: '.txt' },
    html:  { icon: '🌐', name: 'HTML File', ext: '.html' },
    csv:   { icon: '📋', name: 'CSV File', ext: '.csv' },
  };

  function getFileInfo(type) {
    return fileTypeMap[type] || { icon: '📄', name: 'Unknown', ext: '' };
  }

  // ============================================================
  // File Loading
  // ============================================================
  async function openFileDialog() {
    var result = await ipcRenderer.invoke('convert-to:open-file');
    if (!result) return;
    loadFile(result);
  }

  function handleDroppedFiles(fileList) {
    if (fileList.length === 0) return;
    var file = fileList[0];

    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      var base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
      loadFile({ filePath: file.path || file.name, data: base64 });
    };
    reader.readAsDataURL(file);
  }

  async function loadFile(result) {
    sourceBase64 = result.data;
    sourceFilePath = result.filePath;
    sourceFileName = result.filePath.split(/[\\/]/).pop();
    sourceFileSize = Math.round(Buffer.from(result.data, 'base64').length / 1024);

    // Detect file type
    var detectResult = await ipcRenderer.invoke('convert-to:detect-type', {
      filePath: result.filePath,
    });

    sourceFileType = detectResult.type;

    if (sourceFileType === 'unknown') {
      if (typeof window.SmartPDF.showErrorToast === 'function') {
        window.SmartPDF.showErrorToast('Unsupported file format: ' + detectResult.ext);
      }
      return;
    }

    // For images, clear batch and add this as first
    if (sourceFileType === 'image') {
      imageBatches = [{ base64: sourceBase64, fileName: sourceFileName }];
    }

    showFileInfo();
    showPreview();
    updateSidebarInfo();
    updateSummary();
    dom.performBtn.disabled = false;
  }

  // ============================================================
  // UI Updates
  // ============================================================
  function showFileInfo() {
    var info = getFileInfo(sourceFileType);

    dom.dropArea.classList.add('hidden');
    dom.infoArea.classList.remove('hidden');

    dom.fileIcon.textContent = info.icon;
    dom.fileName.textContent = sourceFileName;
    dom.fileType.textContent = info.name;
    dom.fileSize.textContent = formatFileSize(sourceFileSize);
  }

  function showPreview() {
    dom.previewContent.innerHTML = '';

    if (sourceFileType === 'image') {
      showImagePreview();
    } else {
      showTextPreview();
    }
  }

  function showImagePreview() {
    var grid = document.createElement('div');
    grid.className = 'createpdf-image-grid';

    imageBatches.forEach(function (batch) {
      var img = document.createElement('img');
      img.className = 'createpdf-image-thumb';
      img.src = 'data:image/png;base64,' + batch.base64;
      img.alt = batch.fileName;
      img.title = batch.fileName;
      grid.appendChild(img);
    });

    dom.previewContent.appendChild(grid);

    var count = document.createElement('div');
    count.className = 'createpdf-image-count';
    count.textContent = imageBatches.length + ' image' + (imageBatches.length !== 1 ? 's' : '');
    dom.previewContent.appendChild(count);
  }

  function showTextPreview() {
    var text = Buffer.from(sourceBase64, 'base64').toString('utf-8');
    var previewEl = document.createElement('div');

    if (sourceFileType === 'html') {
      // Show stripped text preview
      var stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      var lines = stripped.split('\n').filter(function(l) { return l.trim(); });
      var maxPreview = Math.min(lines.length, 30);
      for (var i = 0; i < maxPreview; i++) {
        var p = document.createElement('p');
        p.textContent = lines[i].substring(0, 200);
        previewEl.appendChild(p);
      }
      if (lines.length > 30) {
        var more = document.createElement('p');
        more.style.cssText = 'color:#999;font-style:italic;';
        more.textContent = '... and ' + (lines.length - 30) + ' more lines';
        previewEl.appendChild(more);
      }
    } else if (sourceFileType === 'docx' || sourceFileType === 'xlsx' || sourceFileType === 'csv') {
      // Show file info instead of raw binary
      var info = document.createElement('p');
      info.textContent = 'File loaded successfully. Click "Create PDF" to generate the PDF.';
      info.style.color = '#666';
      previewEl.appendChild(info);
    } else {
      // TXT: show first 50 lines
      var lines = text.split('\n').filter(function(l) { return l.trim(); });
      var maxPreview = Math.min(lines.length, 50);
      for (var i = 0; i < maxPreview; i++) {
        var p = document.createElement('p');
        p.textContent = lines[i].substring(0, 200);
        previewEl.appendChild(p);
      }
      if (lines.length > 50) {
        var more = document.createElement('p');
        more.style.cssText = 'color:#999;font-style:italic;';
        more.textContent = '... and ' + (lines.length - 50) + ' more lines';
        previewEl.appendChild(more);
      }
    }

    dom.previewContent.appendChild(previewEl);
  }

  function updateSidebarInfo() {
    var info = getFileInfo(sourceFileType);

    dom.infoFileName.textContent = sourceFileName || '—';
    dom.infoFormat.textContent = info.name || '—';
    dom.infoSize.textContent = formatFileSize(sourceFileSize) || '—';

    // Estimate pages
    var estPages = estimatePages();
    dom.infoPages.textContent = estPages;

    // Show/hide batch option for images
    dom.batchOption.classList.toggle('hidden', sourceFileType !== 'image');
  }

  function estimatePages() {
    if (sourceFileType === 'image') {
      return imageBatches.length;
    }

    // Rough estimate based on file size
    if (sourceFileSize < 10) return 1;
    if (sourceFileSize < 50) return 2;
    if (sourceFileSize < 200) return 5;
    if (sourceFileSize < 1000) return 10;
    return Math.ceil(sourceFileSize / 200);
  }

  function updateSummary() {
    var info = getFileInfo(sourceFileType);
    var estPages = estimatePages();

    if (sourceFileType === 'image') {
      dom.summaryText.textContent = '📄 Create PDF from ' + imageBatches.length + ' image' + (imageBatches.length !== 1 ? 's' : '');
    } else {
      dom.summaryText.textContent = '📄 Convert ' + info.name + ' to PDF (~' + estPages + ' page' + (estPages !== 1 ? 's' : '') + ')';
    }
  }

  function formatFileSize(kb) {
    if (kb < 1024) return kb + ' KB';
    return (kb / 1024).toFixed(1) + ' MB';
  }

  // ============================================================
  // Add More Images (batch mode)
  // ============================================================
  async function addMoreImages() {
    var results = await ipcRenderer.invoke('convert-to:open-images');
    if (!results || results.length === 0) return;

    results.forEach(function (result) {
      var name = result.filePath.split(/[\\/]/).pop();
      imageBatches.push({ base64: result.data, fileName: name });
    });

    // Update total file size
    var totalSize = imageBatches.reduce(function (sum, batch) {
      return sum + Math.round(Buffer.from(batch.base64, 'base64').length / 1024);
    }, 0);
    sourceFileSize = totalSize;

    // Update first file name for reference
    if (imageBatches.length > 0 && !sourceFileName) {
      sourceFileName = imageBatches[0].fileName;
    }

    showImagePreview();
    updateSidebarInfo();
    updateSummary();
  }

  // ============================================================
  // Change File
  // ============================================================
  function resetAndOpen() {
    sourceBase64 = null;
    sourceFileName = '';
    sourceFilePath = '';
    sourceFileType = '';
    sourceFileSize = 0;
    imageBatches = [];

    dom.infoArea.classList.add('hidden');
    dom.dropArea.classList.remove('hidden');
    dom.performBtn.disabled = true;
    dom.summaryText.textContent = 'Open a file to get started';

    openFileDialog();
  }

  // ============================================================
  // Create PDF Engine
  // ============================================================
  async function performCreatePdf() {
    if (isCreating || !sourceBase64) return;
    isCreating = true;
    dom.performBtn.disabled = true;

    try {
      showProgress('Preparing PDF...', 10);

      var pageSize = dom.pageSize.value;
      var orientation = dom.orientation.value;
      var margin = parseInt(dom.margin.value, 10) || 40;

      var result;

      switch (sourceFileType) {
        case 'image':
          showProgress('Embedding images...', 20);
          result = await ipcRenderer.invoke('convert-to:from-image', {
            base64Array: imageBatches.map(function(b) { return b.base64; }),
            fileNames: imageBatches.map(function(b) { return b.fileName; }),
            pageSize: pageSize,
            orientation: orientation,
            margin: margin,
          });
          break;

        case 'txt':
          showProgress('Creating text PDF...', 20);
          result = await ipcRenderer.invoke('convert-to:from-txt', {
            base64: sourceBase64,
            fileName: sourceFileName,
            pageSize: pageSize,
            orientation: orientation,
            margin: margin,
          });
          break;

        case 'docx':
          showProgress('Converting Word document...', 20);
          result = await ipcRenderer.invoke('convert-to:from-docx', {
            base64: sourceBase64,
            fileName: sourceFileName,
            pageSize: pageSize,
            orientation: orientation,
            margin: margin,
          });
          break;

        case 'xlsx':
        case 'csv':
          showProgress('Converting spreadsheet...', 20);
          result = await ipcRenderer.invoke('convert-to:from-xlsx', {
            base64: sourceBase64,
            fileName: sourceFileName,
            pageSize: pageSize,
            orientation: orientation,
            margin: margin,
          });
          break;

        case 'html':
          showProgress('Converting HTML document...', 20);
          result = await ipcRenderer.invoke('convert-to:from-html', {
            base64: sourceBase64,
            fileName: sourceFileName,
            pageSize: pageSize,
            orientation: orientation,
            margin: margin,
          });
          break;

        default:
          throw new Error('Unsupported file type: ' + sourceFileType);
      }

      if (!result || !result.success) {
        throw new Error(result ? (result.error || 'Conversion failed') : 'No response from handler');
      }

      showProgress('Saving PDF...', 80);

      var savedPath = await ipcRenderer.invoke('convert-to:save-pdf', {
        base64: result.data.base64,
        defaultName: result.data.fileName,
      });

      if (!savedPath) {
        showProgress('Cancelled', 0);
        setTimeout(hideProgress, 500);
        isCreating = false;
        dom.performBtn.disabled = false;
        return;
      }

      showProgress('Done!', 100);
      setTimeout(hideProgress, 800);

    } catch (err) {
      console.error('[create-pdf]', err);
      hideProgress();
      if (typeof window.SmartPDF.showErrorToast === 'function') {
        window.SmartPDF.showErrorToast('PDF creation failed: ' + err.message);
      } else {
        alert('PDF creation failed: ' + err.message);
      }
    } finally {
      isCreating = false;
      dom.performBtn.disabled = false;
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
  // Event Binding
  // ============================================================
  function bindEvents() {
    var featureMain = document.querySelector('.feature-main');

    // Drag-and-drop
    featureMain.addEventListener('dragover', function (e) { e.preventDefault(); });
    featureMain.addEventListener('drop', function (e) {
      e.preventDefault();
      handleDroppedFiles(e.dataTransfer.files);
    });

    // Click drop zone to open file
    dom.dropArea.addEventListener('click', function (e) {
      if (e.target === dom.openFileBtn || dom.openFileBtn.contains(e.target)) return;
      openFileDialog();
    });
    dom.openFileBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openFileDialog();
    });

    // Change file button
    dom.changeFileBtn.addEventListener('click', resetAndOpen);

    // Add more images (batch mode)
    dom.addImagesBtn.addEventListener('click', addMoreImages);

    // Options change
    dom.pageSize.addEventListener('change', updateSummary);
    dom.orientation.addEventListener('change', updateSummary);
    dom.margin.addEventListener('change', updateSummary);

    // Create PDF button
    dom.performBtn.addEventListener('click', performCreatePdf);

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
    if (!dom.dropArea) {
      console.warn('[create-pdf] DOM not ready, retrying...');
      setTimeout(init, 100);
      return;
    }

    bindEvents();
    dom.summaryText.textContent = 'Open a file to get started';

    console.log('[create-pdf] Initialized — ready to accept files');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();