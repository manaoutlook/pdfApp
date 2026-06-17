// ============================================================
// SmartPDF - eSign Feature
// ============================================================

(function() {
  'use strict';

  const { ipcRenderer } = require('electron');
  const pdfjsLib = require('pdfjs-dist');
  const { PDFDocument } = require('pdf-lib');

  // Set worker path
  pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/build/pdf.worker.entry');

  // ============================================================
  // State
  // ============================================================
  let pdfDoc = null;
  let pdfDataBase64 = null;
  let currentPage = 1;
  let totalPages = 0;
  let scale = 1.5;
  let signatures = [];
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
    };
  }

  // ============================================================
  // Signature Drawing Canvas
  // ============================================================
  let sigCtx = null;
  let sigCanvasWidth = 0;
  let sigCanvasHeight = 0;

  function initSigCanvas() {
    if (!dom.sigCanvas) return;
    sigCtx = dom.sigCanvas.getContext('2d');
    sigCanvasWidth = dom.sigCanvas.clientWidth;
    sigCanvasHeight = dom.sigCanvas.clientHeight;
    dom.sigCanvas.width = sigCanvasWidth;
    dom.sigCanvas.height = sigCanvasHeight;
    sigCtx.strokeStyle = '#000';
    sigCtx.lineWidth = 2;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
  }

  function resizeSigCanvas() {
    if (!dom.sigCanvas) return;
    sigCanvasWidth = dom.sigCanvas.clientWidth;
    sigCanvasHeight = dom.sigCanvas.clientHeight;
    dom.sigCanvas.width = sigCanvasWidth;
    dom.sigCanvas.height = sigCanvasHeight;
    if (sigCtx) {
      sigCtx.strokeStyle = '#000';
      sigCtx.lineWidth = 2;
      sigCtx.lineCap = 'round';
      sigCtx.lineJoin = 'round';
    }
  }

  function getSigCanvasPos(e) {
    const rect = dom.sigCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (dom.sigCanvas.width / rect.width),
      y: (clientY - rect.top) * (dom.sigCanvas.height / rect.height),
    };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing = true;
    const pos = getSigCanvasPos(e);
    drawPoints = [pos];
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
    sigCtx.clearRect(0, 0, dom.sigCanvas.width, dom.sigCanvas.height);
    drawPoints = [];
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
    reader.onload = (e) => {
      savedSignatures.push({ id: sigIdCounter++, dataUrl: e.target.result, type: 'image' });
      renderSavedSignatures();
    };
    reader.readAsDataURL(file);
  }

  async function openImageDialog() {
    const result = await ipcRenderer.invoke('esign:open-image');
    if (result) {
      const dataUrl = `data:image/${getExt(result.filePath)};base64,${result.data}`;
      savedSignatures.push({ id: sigIdCounter++, dataUrl, type: 'image' });
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
  // PDF Loading
  // ============================================================
  async function openPdfDialog() {
    const result = await ipcRenderer.invoke('esign:open-pdf');
    if (result) {
      loadPdfFromBase64(result.filePath, result.data);
    }
  }

  function loadPdfFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = arrayBufferToBase64(e.target.result);
      loadPdfFromBase64(file.name, base64);
    };
    reader.readAsArrayBuffer(file);
  }

  function loadPdfFromBase64(filePath, base64) {
    pdfDataBase64 = base64;
    const fileName = filePath.split(/[/\\]/).pop();
    dom.fileName.textContent = `📄 ${fileName}`;

    const loadingTask = pdfjsLib.getDocument({ data: atob(base64) });
    loadingTask.promise.then((doc) => {
      pdfDoc = doc;
      totalPages = doc.numPages;
      currentPage = 1;
      signatures = [];
      clearOverlay();
      showPdfView();
      renderPage(currentPage);
      dom.savePdfBtn.disabled = false;
    }).catch((err) => {
      alert('Failed to load PDF: ' + err.message);
    });
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function showPdfView() {
    dom.pdfDropArea.classList.add('hidden');
    dom.pdfPageContainer.classList.remove('hidden');
  }

  function hidePdfView() {
    dom.pdfDropArea.classList.remove('hidden');
    dom.pdfPageContainer.classList.add('hidden');
  }

  // ============================================================
  // Page Rendering
  // ============================================================
  async function renderPage(pageNum) {
    if (!pdfDoc) return;

    const page = await pdfDoc.getPage(pageNum);
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

    const info = `Page ${pageNum} / ${totalPages}`;
    dom.pageInfo.textContent = info;
    dom.pageInfoBottom.textContent = info;

    clearOverlay();
    signatures
      .filter((s) => s.page === pageNum)
      .forEach((s) => renderPlaceSignature(s));
  }

  function clearOverlay() {
    dom.sigOverlay.innerHTML = '';
  }

  // ============================================================
  // Place Signatures on PDF
  // ============================================================
  function placeSignatureOnPage(dataUrl) {
    if (!pdfDoc) {
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
        page: currentPage,
        x: (overlayWidth - sigWidth) / 2,
        y: (overlayHeight - sigHeight) / 2,
        width: sigWidth,
        height: sigHeight,
        dataUrl: dataUrl,
        originalWidth: img.width,
        originalHeight: img.height,
      };

      signatures.push(sig);
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
    el.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      signatures = signatures.filter((s) => s.id !== sig.id);
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
    const els = dom.sigOverlay.querySelectorAll('.placed-signature');
    els.forEach((el) => {
      const sigId = parseInt(el.dataset.sigId);
      const sig = signatures.find((s) => s.id === sigId);
      if (sig) {
        sig.x = parseFloat(el.style.left);
        sig.y = parseFloat(el.style.top);
        sig.width = parseFloat(el.style.width);
        sig.height = parseFloat(el.style.height);
      }
    });
  }

  // ============================================================
  // Save Signed PDF
  // ============================================================
  async function saveSignedPdf() {
    if (!pdfDataBase64) return;

    const pdfDocLib = await PDFDocument.load(atob(pdfDataBase64));

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
      });
    }

    const pdfBytes = await pdfDocLib.save();
    const base64 = btoa(String.fromCharCode(...pdfBytes));

    const saved = await ipcRenderer.invoke('esign:save-pdf', base64);
    if (saved) {
      alert('PDF saved successfully!');
    }
  }

  function base64ToBytes(base64) {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
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

    // PDF drop
    const pdfViewer = document.querySelector('.feature-main');
    pdfViewer.addEventListener('dragover', (e) => e.preventDefault());
    pdfViewer.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.pdf')) {
        loadPdfFromFile(files[0]);
      }
    });

    dom.openPdfBtn.addEventListener('click', openPdfDialog);

    // Page navigation
    dom.prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderPage(currentPage); }
    });
    dom.nextPageBtn.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; renderPage(currentPage); }
    });

    dom.savePdfBtn.addEventListener('click', saveSignedPdf);

    // Window resize
    window.addEventListener('resize', resizeSigCanvas);
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    cacheDom();
    if (!dom.sigCanvas) return; // Not on eSign page

    initSigCanvas();
    setupGlobalEvents();
    bindEvents();
    resizeSigCanvas();
    console.log('eSign feature initialized');
  }

  // Register init function so the router can call it
  if (!window.__featureInit) window.__featureInit = {};
  window.__featureInit.esign = init;

  // Auto-init if DOM is already ready (direct load)
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();