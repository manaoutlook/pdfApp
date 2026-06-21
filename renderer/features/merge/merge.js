// ============================================================
// SmartPDF - Merge Feature
// Drop zone is ALWAYS visible — user can keep adding files.
// Preview area shows below the drop zone when a file is selected.
// Merge engine uses pdf-lib: copyPages preserves all content.
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

  let mergeFiles = [];          // { filePath, fileName, data (base64), pages, sizeBytes }
  let selectedIndex = -1;
  let mergedBase64 = null;
  let isMerging = false;
  let dragSrcIndex = -1;

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      dropArea:          document.getElementById('merge-pdfDropArea'),
      dropTitle:         document.getElementById('merge-dropTitle'),
      pdfPageContainer:  document.getElementById('merge-pdfPageContainer'),
      pdfPagesScroll:    document.getElementById('merge-pdfPagesScroll'),
      pageInfoBottom:    document.getElementById('merge-pageInfoBottom'),
      previewFileName:   document.getElementById('merge-previewFileName'),
      addPdfBtn:         document.getElementById('merge-addPdfBtn'),
      savePdfBtn:        document.getElementById('merge-savePdfBtn'),
      performMergeBtn:   document.getElementById('merge-performMergeBtn'),
      fileList:          document.getElementById('merge-fileList'),
      emptyState:        document.getElementById('merge-emptyState'),
      fileStats:         document.getElementById('merge-fileStats'),
      totalFiles:        document.getElementById('merge-totalFiles'),
      totalPages:        document.getElementById('merge-totalPages'),
      totalSize:         document.getElementById('merge-totalSize'),
      reorderSection:    document.getElementById('merge-reorderSection'),
      moveUpBtn:         document.getElementById('merge-moveUpBtn'),
      moveDownBtn:       document.getElementById('merge-moveDownBtn'),
      removeBtn:         document.getElementById('merge-removeBtn'),
      addBookmarks:      document.getElementById('merge-addBookmarks'),
      addBlankPage:      document.getElementById('merge-addBlankPage'),
      progressOverlay:   document.getElementById('merge-progressOverlay'),
      progressText:      document.getElementById('merge-progressText'),
      progressFill:      document.getElementById('merge-progressFill'),
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

  function onTabLoaded(tab) {
    // Show preview container (drop zone stays visible too — independent)
    dom.pdfPageContainer.classList.remove('hidden');
    updatePreviewInfo(tab);
    pdfViewer.renderAllPages(tab);
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function updatePreviewInfo(tab) {
    dom.pageInfoBottom.textContent = 'Page ' + tab.currentPage + ' / ' + tab.totalPages;
    dom.previewFileName.textContent = '📄 Preview: ' + tab.fileName;
  }

  // ============================================================
  // PDF Loading — via native dialog
  // ============================================================
  async function openPdfDialog() {
    if (!pdfTabs) return;
    var result = await ipcRenderer.invoke('merge:open-pdf');
    if (!result) return;
    var files = Array.isArray(result) ? result : [result];
    await addFilesToMergeList(files);
    if (mergeFiles.length > 0 && !getActiveTab()) {
      previewFile(0);
    }
  }

  // ============================================================
  // Process files added via drag-and-drop (File objects from DOM)
  // ============================================================
  function handleDroppedFiles(fileList) {
    if (fileList.length === 0) return;

    var pdfFiles = [];
    for (var i = 0; i < fileList.length; i++) {
      if (fileList[i].name.toLowerCase().endsWith('.pdf')) {
        pdfFiles.push(fileList[i]);
      }
    }
    if (pdfFiles.length === 0) return;

    // Read each file with FileReader, then add to merge list
    var loaded = 0;
    var results = [];
    pdfFiles.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        var base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
        results.push({
          filePath: file.path || file.name,
          data: base64,
        });
        loaded++;
        if (loaded === pdfFiles.length) {
          addFilesToMergeList(results).then(function () {
            if (mergeFiles.length > 0 && !getActiveTab()) {
              previewFile(0);
            }
          });
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  // Add files to the merge list (from dialog or drag-and-drop)
  // ============================================================
  async function addFilesToMergeList(fileResults) {
    for (var i = 0; i < fileResults.length; i++) {
      var file = fileResults[i];
      var fileName = file.filePath.split(/[\\/]/).pop();
      var sizeBytes = base64ToBytes(file.data);

      var pageCount = 0;
      try {
        var pdfBytes = Buffer.from(file.data, 'base64');
        var pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        pageCount = pdfDoc.getPageCount();
      } catch (err) {
        console.warn('[merge] Could not count pages for ' + fileName + ':', err.message);
      }

      mergeFiles.push({
        filePath: file.filePath,
        fileName: fileName,
        data: file.data,
        pages: pageCount,
        sizeBytes: sizeBytes,
      });
    }

    // Update drop zone title to reflect file count
    var count = mergeFiles.length;
    dom.dropTitle.textContent = count + ' file' + (count !== 1 ? 's' : '') + ' added';

    renderFileList();
    updateStatsAndButtons();
  }

  // ============================================================
  // Load a file from the list into the preview viewer
  // ============================================================
  function previewFile(index) {
    if (index < 0 || index >= mergeFiles.length || !pdfTabs) return;
    selectedIndex = index;
    var file = mergeFiles[index];
    pdfTabs.openFiles([{ filePath: file.filePath, data: file.data }]);
    renderFileList();
    updateReorderButtons();
  }

  // ============================================================
  // File List Rendering
  // ============================================================
  function renderFileList() {
    var items = dom.fileList.querySelectorAll('.merge-file-item');
    items.forEach(function (el) { el.remove(); });

    if (mergeFiles.length === 0) {
      dom.emptyState.style.display = '';
      dom.fileStats.classList.add('hidden');
      dom.reorderSection.classList.add('hidden');
      dom.dropTitle.textContent = 'Drop PDF files here';
      return;
    }

    dom.emptyState.style.display = 'none';
    dom.fileStats.classList.remove('hidden');
    dom.reorderSection.classList.remove('hidden');

    mergeFiles.forEach(function (file, i) {
      var el = document.createElement('div');
      el.className = 'merge-file-item';
      if (i === selectedIndex) el.classList.add('selected');
      el.dataset.index = i;
      el.draggable = true;

      el.innerHTML =
        '<span class="merge-file-drag-handle">⋮⋮</span>' +
        '<span class="merge-file-index">' + (i + 1) + '</span>' +
        '<div class="merge-file-info">' +
          '<span class="merge-file-name" title="' + escapeHtml(file.fileName) + '">' + escapeHtml(file.fileName) + '</span>' +
          '<span class="merge-file-meta">' +
            '<span>' + file.pages + ' pages</span>' +
            '<span>' + formatBytes(file.sizeBytes) + '</span>' +
          '</span>' +
        '</div>';

      el.addEventListener('click', function () { previewFile(i); });
      el.addEventListener('dragstart', function (e) { onDragStart(e, i); });
      el.addEventListener('dragover', function (e) { e.preventDefault(); el.classList.add('drag-over'); });
      el.addEventListener('dragleave', function () { el.classList.remove('drag-over'); });
      el.addEventListener('drop', function (e) { e.preventDefault(); el.classList.remove('drag-over'); onDrop(e, i); });
      el.addEventListener('dragend', function () { clearDragStyles(); });

      dom.fileList.appendChild(el);
    });
  }

  function updateReorderButtons() {
    var hasSelection = selectedIndex >= 0 && mergeFiles.length > 1;
    dom.moveUpBtn.disabled = !hasSelection || selectedIndex === 0;
    dom.moveDownBtn.disabled = !hasSelection || selectedIndex === mergeFiles.length - 1;
    dom.removeBtn.disabled = selectedIndex < 0;
  }

  function moveFile(direction) {
    if (selectedIndex < 0) return;
    var newIndex = selectedIndex + direction;
    if (newIndex < 0 || newIndex >= mergeFiles.length) return;

    var temp = mergeFiles[selectedIndex];
    mergeFiles[selectedIndex] = mergeFiles[newIndex];
    mergeFiles[newIndex] = temp;
    selectedIndex = newIndex;
    renderFileList();
    updateReorderButtons();
    mergedBase64 = null;
    dom.savePdfBtn.disabled = true;
  }

  function removeSelectedFile() {
    if (selectedIndex < 0) return;
    mergeFiles.splice(selectedIndex, 1);
    if (mergeFiles.length === 0) {
      selectedIndex = -1;
      dom.pdfPageContainer.classList.add('hidden');
      if (pdfViewer) pdfViewer.clearAllPages();
    } else if (selectedIndex >= mergeFiles.length) {
      selectedIndex = mergeFiles.length - 1;
    }
    renderFileList();
    updateStatsAndButtons();
    mergedBase64 = null;
    dom.savePdfBtn.disabled = true;

    if (selectedIndex >= 0) {
      previewFile(selectedIndex);
    }
  }

  // ============================================================
  // Drag-and-Drop Reorder
  // ============================================================
  function onDragStart(e, index) {
    dragSrcIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }

  function onDrop(e, targetIndex) {
    if (dragSrcIndex < 0 || dragSrcIndex === targetIndex) return;
    var dragged = mergeFiles.splice(dragSrcIndex, 1)[0];
    mergeFiles.splice(targetIndex, 0, dragged);

    if (selectedIndex === dragSrcIndex) {
      selectedIndex = targetIndex;
    } else if (dragSrcIndex < selectedIndex && targetIndex >= selectedIndex) {
      selectedIndex--;
    } else if (dragSrcIndex > selectedIndex && targetIndex <= selectedIndex) {
      selectedIndex++;
    }

    dragSrcIndex = -1;
    renderFileList();
    updateReorderButtons();
    mergedBase64 = null;
    dom.savePdfBtn.disabled = true;
  }

  function clearDragStyles() {
    var items = dom.fileList.querySelectorAll('.merge-file-item');
    items.forEach(function (el) { el.classList.remove('drag-over'); });
    dragSrcIndex = -1;
  }

  // ============================================================
  // Stats & Button State
  // ============================================================
  function updateStatsAndButtons() {
    var count = mergeFiles.length;
    dom.totalFiles.textContent = count;
    dom.totalPages.textContent = mergeFiles.reduce(function (sum, f) { return sum + (f.pages || 0); }, 0);
    var totalBytes = mergeFiles.reduce(function (sum, f) { return sum + f.sizeBytes; }, 0);
    dom.totalSize.textContent = formatBytes(totalBytes);

    var canMerge = count >= 2;
    dom.performMergeBtn.disabled = !canMerge;
    dom.savePdfBtn.disabled = mergedBase64 === null;
    updateReorderButtons();
  }

  // ============================================================
  // Merge Engine
  // ============================================================
  async function performMerge() {
    if (mergeFiles.length < 2 || isMerging) return;
    isMerging = true;
    dom.performMergeBtn.disabled = true;
    dom.savePdfBtn.disabled = true;
    mergedBase64 = null;

    var addBlankPage = dom.addBlankPage.checked;

    try {
      showProgress('Loading PDF files...', 5);

      var sourceDocs = [];
      var totalFiles = mergeFiles.length;
      for (var i = 0; i < totalFiles; i++) {
        var pdfBytes = Buffer.from(mergeFiles[i].data, 'base64');
        var doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        sourceDocs.push({ doc: doc, name: mergeFiles[i].fileName });
        updateProgress(10 + Math.round((i + 1) / totalFiles * 40));
      }

      showProgress('Merging pages...', 55);
      var mergedDoc = await PDFDocument.create();
      var BLANK_PAGE_WIDTH = 595;
      var BLANK_PAGE_HEIGHT = 842;

      for (var j = 0; j < sourceDocs.length; j++) {
        var source = sourceDocs[j];
        var pageIndices = source.doc.getPageIndices();
        var copiedPages = await mergedDoc.copyPages(source.doc, pageIndices);
        copiedPages.forEach(function (page) {
          mergedDoc.addPage(page);
        });

        if (addBlankPage && j < sourceDocs.length - 1) {
          mergedDoc.addPage([BLANK_PAGE_WIDTH, BLANK_PAGE_HEIGHT]);
        }

        updateProgress(55 + Math.round((j + 1) / sourceDocs.length * 40));
      }

      showProgress('Saving merged PDF...', 95);

      var mergedBytes = await mergedDoc.save({ useObjectStreams: true });
      mergedBase64 = Buffer.from(mergedBytes).toString('base64');

      showProgress('Done!', 100);
      console.log('[merge] ' + mergeFiles.length + ' files merged — ' +
        formatBytes(base64ToBytes(mergedBase64)));

      // Load merged result for preview
      if (pdfTabs) {
        var mergedFileName = mergeFiles.map(function (f) { return f.fileName.replace(/\.pdf$/, ''); }).join(' + ') + '.pdf';
        pdfTabs.openFiles([{ filePath: mergedFileName, data: mergedBase64 }]);
      }

      dom.savePdfBtn.disabled = false;
      dom.previewFileName.textContent = '✅ Merged: ' + mergeFiles.length + ' files → 1 PDF';
      updateStatsAndButtons();
      dom.savePdfBtn.disabled = false;

      setTimeout(hideProgress, 800);
    } catch (err) {
      console.error('[merge]', err);
      hideProgress();
      if (typeof window.SmartPDF.showErrorToast === 'function') {
        window.SmartPDF.showErrorToast('Merge failed: ' + err.message);
      } else {
        alert('Merge failed: ' + err.message);
      }
      mergedBase64 = null;
      updateStatsAndButtons();
    } finally {
      isMerging = false;
      dom.performMergeBtn.disabled = mergeFiles.length < 2;
    }
  }

  async function saveMergedPdf() {
    if (!mergedBase64) {
      alert('Please merge PDFs first.');
      return;
    }
    var saved = await ipcRenderer.invoke('merge:save-pdf', mergedBase64);
    if (saved && pdfTabs) {
      var tab = getActiveTab();
      if (tab) {
        pdfTabs.updateTabData(tab.id, mergedBase64);
        pdfTabs.setTabDirty(tab.id, false);
      }
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

  function updateProgress(percent) {
    dom.progressFill.style.width = Math.round(percent) + '%';
  }

  // ============================================================
  // Utilities
  // ============================================================
  function base64ToBytes(base64) {
    var padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return (base64.length * 3) / 4 - padding;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

    // Drag-and-drop onto the feature (add files)
    featureMain.addEventListener('dragover', function (e) { e.preventDefault(); });
    featureMain.addEventListener('drop', function (e) {
      e.preventDefault();
      handleDroppedFiles(e.dataTransfer.files);
    });

    // Click on drop zone or Add PDFs button → open native dialog
    dom.dropArea.addEventListener('click', function (e) {
      // Don't open dialog if the inner button was clicked (already has handler)
      if (e.target === dom.addPdfBtn || dom.addPdfBtn.contains(e.target)) return;
      openPdfDialog();
    });
    dom.addPdfBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openPdfDialog();
    });

    dom.performMergeBtn.addEventListener('click', performMerge);
    dom.savePdfBtn.addEventListener('click', saveMergedPdf);

    dom.moveUpBtn.addEventListener('click', function () { moveFile(-1); });
    dom.moveDownBtn.addEventListener('click', function () { moveFile(1); });
    dom.removeBtn.addEventListener('click', removeSelectedFile);

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
      console.error('[merge] Shared PdfTabs not available — retrying in 100ms');
      setTimeout(init, 100);
      return;
    }

    initPdfViewer();
    bindEvents();
    updateStatsAndButtons();

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
    if (existingTab && existingTab.pdfDoc) onTabLoaded(existingTab);

    console.log('[merge] Initialized — drop zone always visible');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();