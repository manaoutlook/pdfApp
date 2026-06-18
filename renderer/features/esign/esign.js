// ============================================================
// SmartPDF - eSign Feature
// Uses the shared PdfTabs component for multi-file management.
// ============================================================

(function() {
  'use strict';

  const { ipcRenderer } = require('electron');
  const { Buffer } = require('buffer');
  const { PDFDocument } = require('pdf-lib');

  // ============================================================
  // State
  // ============================================================
  let pdfTabs = null;
  let scale = 1.5;
  let savedSignatures = [];
  let sigIdCounter = 0;
  let placedSigIdCounter = 0;
  let isDrawing = false;
  let drawPoints = [];
  let dragTarget = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let resizeTarget = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartW = 0;
  let resizeStartH = 0;

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      pdfDropArea: document.getElementById('esign-pdfDropArea'),
      pdfPageContainer: document.getElementById('esign-pdfPageContainer'),
      pdfCanvas: document.getElementById('esign-pdf-canvas'),
      sigOverlay: document.getElementById('esign-signature-overlay'),
      pageInfo: document.getElementById('esign-pageInfo'),
      pageInfoBottom: document.getElementById('esign-pageInfoBottom'),
      fileName: document.getElementById('esign-fileName'),
      openPdfBtn: document.getElementById('esign-openPdfBtn'),
      prevPageBtn: document.getElementById('esign-prevPageBtn'),
      nextPageBtn: document.getElementById('esign-nextPageBtn'),
      savePdfBtn: document.getElementById('esign-savePdfBtn'),
      sigCanvas: document.getElementById('esign-sig-canvas'),
      clearSigBtn: document.getElementById('esign-clearSigBtn'),
      addDrawSigBtn: document.getElementById('esign-addDrawSigBtn'),
      sigList: document.getElementById('esign-sigList'),
      sigCount: document.getElementById('esign-sigCount'),
      sigDropZone: document.getElementById('esign-sigDropZone'),
      openImageBtn: document.getElementById('esign-openImageBtn'),
      tabScroll: document.getElementById('esign-tabScroll'),
      tabBar: document.getElementById('esign-tabBar'),
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

  function getTabSignatures(tab) {
    if (!tab) return [];
    if (!tab.data.signatures) tab.data.signatures = [];
    return tab.data.signatures;
  }

  function onTabSwitched(tab) {
    if (!tab) return;
    dom.pdfPageContainer.classList.remove('hidden');
    dom.pdfDropArea.classList.add('hidden');
    updateTabInfo(tab);
    renderPage(tab);
  }

  function onTabClosed(tabId) {
    // When last tab closes, the PdfTabs handles hiding the tab bar
    if (pdfTabs && pdfTabs.getTabCount() === 0) {
      dom.pdfPageContainer.classList.add('hidden');
      dom.pdfDropArea.classList.remove('hidden');
    }
  }

  function onDocumentLoaded(tab) {
    updateTabInfo(tab);
  }

  function updateTabInfo(tab) {
    const info = `Page ${tab.currentPage} / ${tab.totalPages}`;
    dom.pageInfo.textContent = info;
    dom.pageInfoBottom.textContent = info;
    dom.fileName.textContent = `📄 ${tab.fileName}`;
    dom.savePdfBtn.disabled = false;
  }

  // ============================================================
  // Signature Drawing Canvas
  // ============================================================
  let sigCtx = null;
  let sigCanvasWidth = 0;
  let sigCanvasHeight = 0;

  function initSigCanvas() {
    if (!dom.sigCanvas) return;
    const rect = dom.sigCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    sigCanvasWidth = rect.width;
    sigCanvasHeight = rect.height;
    dom.sigCanvas.width = sigCanvasWidth * dpr;
    dom.sigCanvas.height = sigCanvasHeight * dpr;
    sigCtx = dom.sigCanvas.getContext('2d');
    sigCtx.scale(dpr, dpr);
    sigCtx.clearRect(0, 0, sigCanvasWidth, sigCanvasHeight);
    sigCtx.strokeStyle = '#1a1a2e';
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.shadowColor = 'rgba(0,0,0,0.12)';
    sigCtx.shadowBlur = 2;
  }

  function resizeSigCanvas() {
    if (!dom.sigCanvas) return;
    const rect = dom.sigCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    sigCanvasWidth = rect.width;
    sigCanvasHeight = rect.height;
    dom.sigCanvas.width = sigCanvasWidth * dpr;
    dom.sigCanvas.height = sigCanvasHeight * dpr;
    if (sigCtx) {
      sigCtx.scale(dpr, dpr);
      sigCtx.strokeStyle = '#1a1a2e';
      sigCtx.lineWidth = 3;
      sigCtx.lineCap = 'round';
      sigCtx.lineJoin = 'round';
      sigCtx.shadowColor = 'rgba(0,0,0,0.12)';
      sigCtx.shadowBlur = 2;
    }
  }

  function getSigCanvasPos(e) {
    const rect = dom.sigCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing = true;
    const pos = getSigCanvasPos(e);
    drawPoints = [pos];
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
    sigCtx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
    sigCtx.fillStyle = '#1a1a2e';
    sigCtx.fill();
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
  }

  function draw(e) {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getSigCanvasPos(e);
    drawPoints.push(pos);
    sigCtx.lineTo(pos.x, pos.y);
    sigCtx.stroke();
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
  }

  function stopDraw(e) {
    e.preventDefault();
    isDrawing = false;
    sigCtx.beginPath();
  }

  function clearSigPad() {
    if (!sigCtx || !dom.sigCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    sigCtx.clearRect(0, 0, dom.sigCanvas.width / dpr, dom.sigCanvas.height / dpr);
    drawPoints = [];
  }

  // ============================================================
  // Image Background Removal
  // ============================================================
  function removeImageBackground(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        const corners = [
          getPixelColor(data, 0, 0, canvas.width),
          getPixelColor(data, canvas.width - 1, 0, canvas.width),
          getPixelColor(data, 0, canvas.height - 1, canvas.width),
          getPixelColor(data, canvas.width - 1, canvas.height - 1, canvas.width),
        ];

        let bgColor = corners[0];
        let maxLum = getLuminance(corners[0].r, corners[0].g, corners[0].b);
        for (let i = 1; i < corners.length; i++) {
          const lum = getLuminance(corners[i].r, corners[i].g, corners[i].b);
          if (lum > maxLum) {
            maxLum = lum;
            bgColor = corners[i];
          }
        }

        const bgLuminance = getLuminance(bgColor.r, bgColor.g, bgColor.b);
        const bgTolerance = 30;
        const featherRange = 10;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const pixelLum = getLuminance(r, g, b);

          if (pixelLum >= bgLuminance * 0.85) {
            const dist = colorDistance(r, g, b, bgColor.r, bgColor.g, bgColor.b);
            if (dist < bgTolerance) {
              data[i + 3] = 0;
            } else if (dist < bgTolerance + featherRange) {
              const alpha = Math.round(((dist - bgTolerance) / featherRange) * 255);
              data[i + 3] = Math.min(255, alpha);
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function getPixelColor(data, x, y, width) {
    const idx = (y * width + x) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
  }

  function getLuminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function colorDistance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
  }

  // ============================================================
  // Signature Management
  // ============================================================
  function addDrawnSignature() {
    if (drawPoints.length < 2) {
      alert('Please draw a signature first.');
      return;
    }
    const dataUrl = dom.sigCanvas.toDataURL('image/png');
    savedSignatures.push({ id: sigIdCounter++, dataUrl, type: 'draw' });
    clearSigPad();
    renderSavedSignatures();
  }

  function loadImageFromFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const cleanUrl = await removeImageBackground(e.target.result);
      savedSignatures.push({ id: sigIdCounter++, dataUrl: cleanUrl, type: 'image' });
      renderSavedSignatures();
    };
    reader.readAsDataURL(file);
  }

  async function openImageDialog() {
    const result = await ipcRenderer.invoke('esign:open-image');
    if (result) {
      const dataUrl = `data:image/${getExt(result.filePath)};base64,${result.data}`;
      const cleanUrl = await removeImageBackground(dataUrl);
      savedSignatures.push({ id: sigIdCounter++, dataUrl: cleanUrl, type: 'image' });
      renderSavedSignatures();
    }
  }

  function getExt(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    if (ext === 'gif') return 'gif';
    if (ext === 'bmp') return 'bmp';
    return 'png';
  }

  function renderSavedSignatures() {
    dom.sigList.innerHTML = '';
    dom.sigCount.textContent = `(${savedSignatures.length})`;
    savedSignatures.forEach((sig) => {
      const item = document.createElement('div');
      item.className = 'sig-list-item';
      item.title = 'Click to place on PDF';

      const img = document.createElement('img');
      img.src = sig.dataUrl;
      item.appendChild(img);

      const delBtn = document.createElement('button');
      delBtn.className = 'del-sig';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        savedSignatures = savedSignatures.filter((s) => s.id !== sig.id);
        renderSavedSignatures();
      });
      item.appendChild(delBtn);

      item.addEventListener('click', () => {
        placeSignatureOnPage(sig.dataUrl);
      });

      dom.sigList.appendChild(item);
    });
  }

  // ============================================================
  // PDF Loading - Uses shared PdfTabs
  // ============================================================
  async function openPdfDialog() {
    const result = await ipcRenderer.invoke('esign:open-pdf');
    if (!result || !pdfTabs) return;

    if (!Array.isArray(result)) {
      // Single file fallback
      pdfTabs.openFiles([{ filePath: result.filePath, data: result.data }]);
      return;
    }
    pdfTabs.openFiles(result);
  }

  function loadPdfFromFile(file) {
    if (!pdfTabs) return;
    const tab = pdfTabs.getTabCount();
    if (tab >= window.SmartPDF.MAX_TABS) {
      alert(`Maximum of ${window.SmartPDF.MAX_TABS} PDFs can be open at once.`);
      return;
    }
    pdfTabs.openFileFromDrop(file, (loadedTab) => {
      // onTabSwitched will handle rendering
    });
  }

  function showPdfView() {
    // Handled by PdfTabs
  }

  // ============================================================
  // Page Rendering
  // ============================================================
  async function renderPage(tab) {
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

    dom.sigOverlay.style.width = canvas.width + 'px';
    dom.sigOverlay.style.height = canvas.height + 'px';

    updateTabInfo(tab);

    clearOverlay();
    getTabSignatures(tab)
      .filter((s) => s.page === tab.currentPage)
      .forEach((s) => renderPlaceSignature(s));
  }

  function clearOverlay() {
    dom.sigOverlay.innerHTML = '';
  }

  // ============================================================
  // Place Signatures on PDF
  // ============================================================
  function placeSignatureOnPage(dataUrl) {
    const tab = getActiveTab();
    if (!tab) {
      alert('Please open a PDF first.');
      return;
    }

    const img = new Image();
    img.onload = () => {
      const overlayWidth = dom.sigOverlay.clientWidth || 600;
      const overlayHeight = dom.sigOverlay.clientHeight || 800;

      const sigWidth = Math.min(img.width * 0.5, overlayWidth * 0.4);
      const sigHeight = (sigWidth / img.width) * img.height;

      const sig = {
        id: placedSigIdCounter++,
        page: tab.currentPage,
        x: (overlayWidth - sigWidth) / 2,
        y: (overlayHeight - sigHeight) / 2,
        width: sigWidth,
        height: sigHeight,
        dataUrl: dataUrl,
        originalWidth: img.width,
        originalHeight: img.height,
      };

      const signatures = getTabSignatures(tab);
      signatures.push(sig);
      pdfTabs.setTabDirty(tab.id, true);
      renderPlaceSignature(sig);
    };
    img.src = dataUrl;
  }

  function renderPlaceSignature(sig) {
    const el = document.createElement('div');
    el.className = 'placed-signature';
    el.dataset.sigId = sig.id;
    el.style.left = sig.x + 'px';
    el.style.top = sig.y + 'px';
    el.style.width = sig.width + 'px';
    el.style.height = sig.height + 'px';

    const img = document.createElement('img');
    img.src = sig.dataUrl;
    img.draggable = false;
    el.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = getActiveTab();
      if (tab) {
        const signatures = getTabSignatures(tab);
        tab.data.signatures = signatures.filter((s) => s.id !== sig.id);
        pdfTabs.setTabDirty(tab.id, tab.data.signatures.length > 0);
      }
      el.remove();
      updateSigPositions();
    });
    el.appendChild(removeBtn);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    el.appendChild(resizeHandle);

    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('remove-btn') || e.target.classList.contains('resize-handle')) return;
      dragTarget = el;
      dragOffsetX = e.clientX - el.getBoundingClientRect().left;
      dragOffsetY = e.clientY - el.getBoundingClientRect().top;
      e.preventDefault();
    });

    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      resizeTarget = el;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = parseFloat(el.style.width);
      resizeStartH = parseFloat(el.style.height);
    });

    dom.sigOverlay.appendChild(el);
  }

  function updateSigPositions() {
    const tab = getActiveTab();
    if (!tab) return;
    const els = dom.sigOverlay.querySelectorAll('.placed-signature');
    els.forEach((el) => {
      const sigId = parseInt(el.dataset.sigId);
      const sig = getTabSignatures(tab).find((s) => s.id === sigId);
      if (sig) {
        sig.x = parseFloat(el.style.left);
        sig.y = parseFloat(el.style.top);
        sig.width = parseFloat(el.style.width);
        sig.height = parseFloat(el.style.height);
      }
    });
  }

  // ============================================================
  // Page Navigation
  // ============================================================
  function prevPage() {
    const tab = getActiveTab();
    if (tab && pdfTabs.prevPage()) {
      renderPage(tab);
    }
  }

  function nextPage() {
    const tab = getActiveTab();
    if (tab && pdfTabs.nextPage()) {
      renderPage(tab);
    }
  }

  // ============================================================
  // Save Signed PDF
  // ============================================================
  async function saveSignedPdf() {
    const tab = getActiveTab();
    if (!tab || !pdfTabs) return;

    const signatures = getTabSignatures(tab);
    if (signatures.length === 0) {
      // Save original PDF if no signatures
      const saved = await ipcRenderer.invoke('esign:save-pdf', tab.base64);
      if (saved) {
        pdfTabs.setTabDirty(tab.id, false);
      }
      return;
    }

    const pdfBytesLoad = Buffer.from(tab.base64, 'base64');
    const pdfDocLib = await PDFDocument.load(pdfBytesLoad);

    for (const sig of signatures) {
      const page = pdfDocLib.getPage(sig.page - 1);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      const canvasWidth = dom.pdfCanvas.width;
      const canvasHeight = dom.pdfCanvas.height;

      const xRatio = pageWidth / canvasWidth;
      const yRatio = pageHeight / canvasHeight;

      const pdfX = sig.x * xRatio;
      const pdfY = pageHeight - (sig.y * yRatio) - (sig.height * yRatio);
      const pdfW = sig.width * xRatio;
      const pdfH = sig.height * yRatio;

      let image;
      if (sig.dataUrl.startsWith('data:image/png')) {
        const pngData = base64ToBytes(sig.dataUrl.split(',')[1]);
        image = await pdfDocLib.embedPng(pngData);
      } else {
        const jpgData = base64ToBytes(sig.dataUrl.split(',')[1]);
        image = await pdfDocLib.embedJpg(jpgData);
      }

      page.drawImage(image, {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH,
        opacity: 0.92,
      });
    }

    const pdfBytes = await pdfDocLib.save();
    const base64 = Buffer.from(pdfBytes).toString('base64');

    const saved = await ipcRenderer.invoke('esign:save-pdf', base64);
    if (saved) {
      pdfTabs.updateTabData(tab.id, base64);
    }
  }

  function base64ToBytes(base64) {
    return Buffer.from(base64, 'base64');
  }

  // ============================================================
  // Global Mouse Events for Drag & Resize
  // ============================================================
  function setupGlobalEvents() {
    document.addEventListener('mousemove', (e) => {
      if (dragTarget) {
        const overlayRect = dom.sigOverlay.getBoundingClientRect();
        let newX = e.clientX - overlayRect.left - dragOffsetX;
        let newY = e.clientY - overlayRect.top - dragOffsetY;
        newX = Math.max(0, Math.min(newX, overlayRect.width - parseFloat(dragTarget.style.width)));
        newY = Math.max(0, Math.min(newY, overlayRect.height - parseFloat(dragTarget.style.height)));
        dragTarget.style.left = newX + 'px';
        dragTarget.style.top = newY + 'px';
        updateSigPositions();
      }

      if (resizeTarget) {
        const dx = e.clientX - resizeStartX;
        const dy = e.clientY - resizeStartY;
        let newW = Math.max(40, resizeStartW + dx);
        let newH = Math.max(20, resizeStartH + dy);
        resizeTarget.style.width = newW + 'px';
        resizeTarget.style.height = newH + 'px';
        updateSigPositions();
      }
    });

    document.addEventListener('mouseup', () => {
      dragTarget = null;
      resizeTarget = null;
    });
  }

  // ============================================================
  // Event Binding
  // ============================================================
  function bindEvents() {
    // Drawing canvas events
    dom.sigCanvas.addEventListener('mousedown', startDraw);
    dom.sigCanvas.addEventListener('mousemove', draw);
    dom.sigCanvas.addEventListener('mouseup', stopDraw);
    dom.sigCanvas.addEventListener('mouseleave', stopDraw);
    dom.sigCanvas.addEventListener('touchstart', startDraw, { passive: false });
    dom.sigCanvas.addEventListener('touchmove', draw, { passive: false });
    dom.sigCanvas.addEventListener('touchend', stopDraw, { passive: false });

    dom.clearSigBtn.addEventListener('click', clearSigPad);
    dom.addDrawSigBtn.addEventListener('click', addDrawnSignature);

    // Image signature drop
    dom.sigDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.sigDropZone.classList.add('drag-over');
    });
    dom.sigDropZone.addEventListener('dragleave', () => {
      dom.sigDropZone.classList.remove('drag-over');
    });
    dom.sigDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dom.sigDropZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) loadImageFromFile(files[0]);
    });
    dom.sigDropZone.addEventListener('click', openImageDialog);
    dom.openImageBtn.addEventListener('click', openImageDialog);

    // PDF drop - uses shared PdfTabs
    const pdfViewer = document.querySelector('.feature-main');
    pdfViewer.addEventListener('dragover', (e) => e.preventDefault());
    pdfViewer.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0 && pdfTabs) {
        const PdfTabs = window.SmartPDF.PdfTabs;
        for (const file of files) {
          if (file.name.endsWith('.pdf')) {
            if (pdfTabs.getTabCount() >= PdfTabs.MAX_TABS) {
              alert(`Maximum of ${PdfTabs.MAX_TABS} PDFs can be open at once.`);
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

    dom.savePdfBtn.addEventListener('click', saveSignedPdf);

    // Window resize
    window.addEventListener('resize', resizeSigCanvas);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dragTarget = null;
        resizeTarget = null;
      }
    });
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    cacheDom();
    if (!dom.sigCanvas) return;

    initSigCanvas();
    initPdfTabs();
    setupGlobalEvents();
    bindEvents();
    resizeSigCanvas();
    console.log('eSign feature initialized with shared PdfTabs');
  }

  if (!window.__featureInit) window.__featureInit = {};
  window.__featureInit.esign = init;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();