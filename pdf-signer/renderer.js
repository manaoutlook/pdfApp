// ============================================================
// PDF Signer - Renderer Process
// ============================================================
const { ipcRenderer } = require('electron');
const pdfjsLib = require('pdfjs-dist');

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
let signatures = []; // { id, page, x, y, width, height, dataUrl, originalWidth, originalHeight }
let savedSignatures = []; // { id, dataUrl, type:'draw'|'image' }
let sigIdCounter = 0;
let placedSigIdCounter = 0;

// Drawing state
let isDrawing = false;
let drawPoints = [];

// Drag state for placed signatures
let dragTarget = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

// Resize state
let resizeTarget = null;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartW = 0;
let resizeStartH = 0;

// ============================================================
// DOM References
// ============================================================
const pdfDropArea = document.getElementById('pdfDropArea');
const pdfPageContainer = document.getElementById('pdfPageContainer');
const pdfCanvas = document.getElementById('pdf-canvas');
const sigOverlay = document.getElementById('signature-overlay');
const pageInfo = document.getElementById('pageInfo');
const pageInfoBottom = document.getElementById('pageInfoBottom');
const dropOverlay = document.getElementById('dropOverlay');
const fileNameEl = document.getElementById('fileName');
const openPdfBtn = document.getElementById('openPdfBtn');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const savePdfBtn = document.getElementById('savePdfBtn');

const sigCanvas = document.getElementById('sig-canvas');
const clearSigBtn = document.getElementById('clearSigBtn');
const addDrawSigBtn = document.getElementById('addDrawSigBtn');
const sigList = document.getElementById('sigList');
const sigCount = document.getElementById('sigCount');
const sigDropZone = document.getElementById('sigDropZone');
const openImageBtn = document.getElementById('openImageBtn');

const pdfViewer = document.getElementById('pdfViewer');

// ============================================================
// Signature Drawing Canvas
// ============================================================
const ctx = sigCanvas.getContext('2d');
let sigCanvasWidth = sigCanvas.clientWidth;
let sigCanvasHeight = sigCanvas.clientHeight;
sigCanvas.width = sigCanvasWidth;
sigCanvas.height = sigCanvasHeight;
ctx.strokeStyle = '#000';
ctx.lineWidth = 2;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

function resizeSigCanvas() {
  sigCanvasWidth = sigCanvas.clientWidth;
  sigCanvasHeight = sigCanvas.clientHeight;
  sigCanvas.width = sigCanvasWidth;
  sigCanvas.height = sigCanvasHeight;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

window.addEventListener('resize', resizeSigCanvas);

function getSigCanvasPos(e) {
  const rect = sigCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (sigCanvas.width / rect.width),
    y: (clientY - rect.top) * (sigCanvas.height / rect.height),
  };
}

function startDraw(e) {
  e.preventDefault();
  isDrawing = true;
  const pos = getSigCanvasPos(e);
  drawPoints = [pos];
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function draw(e) {
  e.preventDefault();
  if (!isDrawing) return;
  const pos = getSigCanvasPos(e);
  drawPoints.push(pos);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function stopDraw(e) {
  e.preventDefault();
  isDrawing = false;
  ctx.beginPath();
}

sigCanvas.addEventListener('mousedown', startDraw);
sigCanvas.addEventListener('mousemove', draw);
sigCanvas.addEventListener('mouseup', stopDraw);
sigCanvas.addEventListener('mouseleave', stopDraw);
sigCanvas.addEventListener('touchstart', startDraw, { passive: false });
sigCanvas.addEventListener('touchmove', draw, { passive: false });
sigCanvas.addEventListener('touchend', stopDraw, { passive: false });

// Clear drawing canvas
function clearSigPad() {
  ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  drawPoints = [];
}

clearSigBtn.addEventListener('click', clearSigPad);

// Add drawn signature to saved list
addDrawSigBtn.addEventListener('click', () => {
  if (drawPoints.length < 2) {
    alert('Please draw a signature first.');
    return;
  }
  const dataUrl = sigCanvas.toDataURL('image/png');
  savedSignatures.push({ id: sigIdCounter++, dataUrl, type: 'draw' });
  clearSigPad();
  renderSavedSignatures();
});

// ============================================================
// Image Signature Import
// ============================================================

// Drop image
sigDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  sigDropZone.classList.add('drag-over');
});
sigDropZone.addEventListener('dragleave', () => {
  sigDropZone.classList.remove('drag-over');
});
sigDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  sigDropZone.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    loadImageFile(files[0]);
  }
});

// Click to browse
sigDropZone.addEventListener('click', () => {
  openImageFileDialog();
});

openImageBtn.addEventListener('click', () => {
  openImageFileDialog();
});

async function openImageFileDialog() {
  const result = await ipcRenderer.invoke('open-image');
  if (result) {
    const dataUrl = `data:image/${getExt(result.filePath)};base64,${result.data}`;
    savedSignatures.push({ id: sigIdCounter++, dataUrl, type: 'image' });
    renderSavedSignatures();
  }
}

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    savedSignatures.push({ id: sigIdCounter++, dataUrl: e.target.result, type: 'image' });
    renderSavedSignatures();
  };
  reader.readAsDataURL(file);
}

// ============================================================
// Saved Signatures List
// ============================================================
function renderSavedSignatures() {
  sigList.innerHTML = '';
  sigCount.textContent = `(${savedSignatures.length})`;
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

    sigList.appendChild(item);
  });
}

// ============================================================
// PDF Loading & Rendering
// ============================================================

// Drag & drop PDF
pdfViewer.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropOverlay.classList.add('visible');
  pdfViewer.classList.add('drag-over');
});
pdfViewer.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('visible');
  pdfViewer.classList.remove('drag-over');
});
pdfViewer.addEventListener('drop', (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('visible');
  pdfViewer.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    if (file.name.endsWith('.pdf')) {
      loadPdfFromFile(file);
    }
  }
});

// Browse PDF
openPdfBtn.addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('open-pdf');
  if (result) {
    loadPdfFromBase64(result.filePath, result.data);
  }
});

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
  fileNameEl.textContent = `📄 ${fileName}`;

  const loadingTask = pdfjsLib.getDocument({ data: atob(base64) });
  loadingTask.promise.then((doc) => {
    pdfDoc = doc;
    totalPages = doc.numPages;
    currentPage = 1;
    signatures = []; // Clear placed signatures when loading new PDF
    clearOverlay();
    showPdfView();
    renderPage(currentPage);
    savePdfBtn.disabled = false;
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

function getExt(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'gif') return 'gif';
  if (ext === 'bmp') return 'bmp';
  return 'png';
}

function showPdfView() {
  pdfDropArea.classList.add('hidden');
  pdfPageContainer.classList.remove('hidden');
}

function hidePdfView() {
  pdfDropArea.classList.remove('hidden');
  pdfPageContainer.classList.add('hidden');
}

// ============================================================
// Page Navigation & Rendering
// ============================================================
prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    renderPage(currentPage);
  }
});

nextPageBtn.addEventListener('click', () => {
  if (currentPage < totalPages) {
    currentPage++;
    renderPage(currentPage);
  }
});

async function renderPage(pageNum) {
  if (!pdfDoc) return;

  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = pdfCanvas;
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const renderContext = {
    canvasContext: context,
    viewport: viewport,
  };

  await page.render(renderContext).promise;

  // Update overlay size
  sigOverlay.style.width = canvas.width + 'px';
  sigOverlay.style.height = canvas.height + 'px';

  // Update page info
  const info = `Page ${pageNum} / ${totalPages}`;
  pageInfo.textContent = info;
  pageInfoBottom.textContent = info;

  // Re-render placed signatures for this page
  clearOverlay();
  signatures
    .filter((s) => s.page === pageNum)
    .forEach((s) => renderPlaceSignature(s));
}

function clearOverlay() {
  sigOverlay.innerHTML = '';
}

// ============================================================
// Place Signature on PDF Page
// ============================================================
function placeSignatureOnPage(dataUrl) {
  if (!pdfDoc) {
    alert('Please open a PDF first.');
    return;
  }

  const img = new Image();
  img.onload = () => {
    const overlayWidth = sigOverlay.clientWidth || 600;
    const overlayHeight = sigOverlay.clientHeight || 800;

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

  // Drag handling
  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('remove-btn') || e.target.classList.contains('resize-handle')) return;
    dragTarget = el;
    dragOffsetX = e.clientX - el.getBoundingClientRect().left;
    dragOffsetY = e.clientY - el.getBoundingClientRect().top;
    e.preventDefault();
  });

  // Resize handling
  resizeHandle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    resizeTarget = el;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = parseFloat(el.style.width);
    resizeStartH = parseFloat(el.style.height);
  });

  sigOverlay.appendChild(el);
}

// Global mouse move/up for drag & resize
document.addEventListener('mousemove', (e) => {
  if (dragTarget) {
    const overlayRect = sigOverlay.getBoundingClientRect();
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

function updateSigPositions() {
  const els = sigOverlay.querySelectorAll('.placed-signature');
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
savePdfBtn.addEventListener('click', async () => {
  if (!pdfDataBase64) return;

  const { PDFDocument } = require('pdf-lib');
  const pdfDocLib = await PDFDocument.load(atob(pdfDataBase64));

  // Process each page's signatures
  for (const sig of signatures) {
    const page = pdfDocLib.getPage(sig.page - 1);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Calculate position relative to PDF page dimensions
    const canvasWidth = pdfCanvas.width;
    const canvasHeight = pdfCanvas.height;

    const xRatio = pageWidth / canvasWidth;
    const yRatio = pageHeight / canvasHeight;

    const pdfX = sig.x * xRatio;
    const pdfY = pageHeight - (sig.y * yRatio) - (sig.height * yRatio);
    const pdfW = sig.width * xRatio;
    const pdfH = sig.height * yRatio;

    // Embed the signature image
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

  const saved = await ipcRenderer.invoke('save-pdf', base64);
  if (saved) {
    alert('PDF saved successfully!');
  }
});

function base64ToBytes(base64) {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

// ============================================================
// Initialization
// ============================================================
resizeSigCanvas();
console.log('PDF Signer ready!');