// ============================================================
// SmartPDF - eSign Feature
// ============================================================

(function() {
  'use strict';

  const { ipcRenderer } = require('electron');
  const { Buffer } = require('buffer');
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
    // Use high-DPI resolution for sharp signatures with natural ink look
    const rect = dom.sigCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    sigCanvasWidth = rect.width;
    sigCanvasHeight = rect.height;
    dom.sigCanvas.width = sigCanvasWidth * dpr;
    dom.sigCanvas.height = sigCanvasHeight * dpr;
    sigCtx = dom.sigCanvas.getContext('2d');
    sigCtx.scale(dpr, dpr);
    // Clear to transparent so signature PNG has no background
    sigCtx.clearRect(0, 0, sigCanvasWidth, sigCanvasHeight);
    // Natural dark ink styling - slightly transparent for authentic pen-on-paper look
    sigCtx.strokeStyle = '#1a1a2e';
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    // Subtle shadow gives depth like real ink bleeding into paper
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
    // Place a small dot at click position for single-tap signatures
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
  /**
   * Removes the background color from a signature image.
   * Uses a conservative approach to preserve the actual ink strokes.
   * Only removes pixels that are lighter than the detected background
   * (to protect dark signature ink from being erased).
   */
  function removeImageBackground(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Use a temporary canvas to process pixels
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;

        // Draw the original image
        ctx.drawImage(img, 0, 0);

        // Get all pixel data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Sample corners to detect the background color
        const corners = [
          getPixelColor(data, 0, 0, canvas.width),
          getPixelColor(data, canvas.width - 1, 0, canvas.width),
          getPixelColor(data, 0, canvas.height - 1, canvas.width),
          getPixelColor(data, canvas.width - 1, canvas.height - 1, canvas.width),
        ];

        // Find the lightest corner - signatures typically have white/light backgrounds
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

        // Conservative threshold - only remove pixels very close to the light background
        // This protects darker ink strokes from being erased
        const bgTolerance = 30;
        const featherRange = 10;

        // Process each pixel
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const pixelLum = getLuminance(r, g, b);

          // Only consider making a pixel transparent if it's as light or lighter than the background
          // This is the key protection: dark ink pixels are NEVER made transparent
          const isLighterOrEqual = pixelLum >= bgLuminance * 0.85;

          // If pixel is lighter than background threshold, check color distance
          if (isLighterOrEqual) {
            const dist = colorDistance(r, g, b, bgColor.r, bgColor.g, bgColor.b);

            if (dist < bgTolerance) {
              // Fully transparent - this is likely background
              data[i + 3] = 0;
            } else if (dist < bgTolerance + featherRange) {
              // Semi-transparent feathering for edge pixels
              const alpha = Math.round(((dist - bgTolerance) / featherRange) * 255);
              data[i + 3] = Math.min(255, alpha);
            }
            // else keep fully opaque
          }
          // Darker pixels than background are always kept fully opaque
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl); // Fallback: return original
      img.src = dataUrl;
    });
  }

  function getPixelColor(data, x, y, width) {
    const idx = (y * width + x) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
  }

  /**
   * Calculates the luminance (perceived brightness) of a pixel.
   * Uses the standard ITU-R BT.601 formula.
   */
  function getLuminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function colorDistance(r1, g1, b1, r2, g2, b2) {
    // Use a weighted Euclidean distance that approximates human perception
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
    // toDataURL('image/png') preserves transparency since canvas background is transparent
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

    const pdfBytes = Buffer.from(base64, 'base64');
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
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
    return Buffer.from(buffer).toString('base64');
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
    img.draggable = false;
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

    const pdfBytesLoad = Buffer.from(pdfDataBase64, 'base64');
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
        // For drawn signatures, embed as PNG which supports transparency
        // For image signatures, also use PNG to preserve transparency if possible
        image = await pdfDocLib.embedPng(pngData);
      } else {
        const jpgData = base64ToBytes(sig.dataUrl.split(',')[1]);
        image = await pdfDocLib.embedJpg(jpgData);
      }

      // Draw with opacity for a more natural ink-on-paper blend
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
      alert('PDF saved successfully!');
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

    dom.pdfDropArea.addEventListener('click', openPdfDialog);
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