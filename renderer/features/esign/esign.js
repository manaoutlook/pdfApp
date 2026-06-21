// ============================================================
// SmartPDF - eSign Feature
// Uses the shared PdfTabs component for multi-file management.
// Renders ALL pages in a vertically scrollable container.
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

  // Page wrapper tracking: pageNum -> { wrapper, canvas, overlay }
  let pageWrappers = new Map();
  let intersectionObserver = null;
  let isScrollingProgrammatically = false;

  // ============================================================
  // DOM References
  // ============================================================
  let dom = {};

  function cacheDom() {
    dom = {
      pdfDropArea: document.getElementById('esign-pdfDropArea'),
      pdfPageContainer: document.getElementById('esign-pdfPageContainer'),
      pdfPagesScroll: document.getElementById('esign-pdfPagesScroll'),
      pageInfoBottom: document.getElementById('esign-pageInfoBottom'),
      fileName: document.getElementById('esign-fileName'),
      openPdfBtn: document.getElementById('esign-openPdfBtn'),
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
    renderAllPages(tab);
    // Sync the global page navigation sidebar
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function onTabClosed(tabId) {
    // When last tab closes, the PdfTabs handles hiding the tab bar
    if (pdfTabs && pdfTabs.getTabCount() === 0) {
      dom.pdfPageContainer.classList.add('hidden');
      dom.pdfDropArea.classList.remove('hidden');
    }
    // Sync the global page navigation sidebar
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function onDocumentLoaded(tab) {
    updateTabInfo(tab);
    // Don't call renderAllPages here — onTabSwitched handles it immediately after
    // in _loadDocument. Calling both causes concurrent async rendering and page duplication.
    // Sync the global page navigation sidebar
    if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
      window.SmartPDF.updatePageNavSidebar();
    }
  }

  function updateTabInfo(tab) {
    const info = `Page ${tab.currentPage} / ${tab.totalPages}`;
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
      sigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    pdfTabs.openFileFromDrop(file);
  }

  // ============================================================
  // Page Rendering - Renders ALL pages in scrollable container
  // ============================================================

  /**
   * Clear all page wrappers from the scroll container.
   */
  function clearAllPages() {
    if (dom.pdfPagesScroll) {
      dom.pdfPagesScroll.innerHTML = '';
    }
    pageWrappers = new Map();
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
  }

  /**
   * Render all pages of the active tab into the scroll container.
   */
  async function renderAllPages(tab) {
    if (!tab || !tab.pdfDoc || !dom.pdfPagesScroll) return;

    clearAllPages();

    const totalPages = tab.totalPages;

    for (let i = 1; i <= totalPages; i++) {
      // Create wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-wrapper';
      wrapper.dataset.page = i;
      wrapper.style.display = 'inline-block';

      // Create canvas
      const canvas = document.createElement('canvas');
      wrapper.appendChild(canvas);

      // Create overlay
      const overlay = document.createElement('div');
      overlay.className = 'pdf-page-overlay';
      wrapper.appendChild(overlay);

      dom.pdfPagesScroll.appendChild(wrapper);

      // Store references
      pageWrappers.set(i, { wrapper, canvas, overlay });

      // Render the page into the canvas
      try {
        const page = await tab.pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;

        overlay.style.width = canvas.width + 'px';
        overlay.style.height = canvas.height + 'px';
      } catch (err) {
        console.error(`Failed to render page ${i}:`, err);
      }
    }

    // Re-render signatures for each page
    restoreAllSignatures(tab);

    // Start IntersectionObserver to detect which page is visible
    setupIntersectionObserver(tab);

    // Scroll to the current page
    scrollToPage(tab.currentPage, false);
  }

  /**
   * Restore placed signatures onto their respective page overlays.
   */
  function restoreAllSignatures(tab) {
    const signatures = getTabSignatures(tab);
    for (const sig of signatures) {
      const pw = pageWrappers.get(sig.page);
      if (pw) {
        renderPlaceSignatureOnOverlay(sig, pw.overlay);
      }
    }
  }

  /**
   * Set up IntersectionObserver to track which page is currently most visible.
   */
  function setupIntersectionObserver(tab) {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
    }

    // Threshold map: pageNum -> visible ratio
    let visibilityMap = new Map();

    intersectionObserver = new IntersectionObserver((entries) => {
      if (isScrollingProgrammatically) return;

      for (const entry of entries) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        if (pageNum) {
          visibilityMap.set(pageNum, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
      }

      // Find the page with the highest intersection ratio
      let bestPage = tab.currentPage;
      let bestRatio = 0;
      for (const [pageNum, ratio] of visibilityMap) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestPage = pageNum;
        }
      }

      if (bestRatio > 0 && bestPage !== tab.currentPage) {
        tab.currentPage = bestPage;
        updateTabInfo(tab);
        // Sync the global page navigation sidebar
        if (typeof window.SmartPDF.updatePageNavSidebar === 'function') {
          window.SmartPDF.updatePageNavSidebar();
        }
      }
    }, {
      root: dom.pdfPagesScroll,
      threshold: [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1],
    });

    for (const [pageNum, pw] of pageWrappers) {
      intersectionObserver.observe(pw.wrapper);
    }
  }

  /**
   * Scroll to a specific page in the container.
   * @param {number} pageNum
   * @param {boolean} smooth - whether to animate smoothly
   */
  function scrollToPage(pageNum, smooth) {
    const pw = pageWrappers.get(pageNum);
    if (!pw) return;

    const tab = getActiveTab();
    if (tab) {
      tab.currentPage = pageNum;
      updateTabInfo(tab);
    }

    isScrollingProgrammatically = true;
    pw.wrapper.scrollIntoView({
      block: 'start',
      behavior: smooth !== false ? 'smooth' : 'auto',
    });

    // Reset the flag after the scroll animation completes
    clearTimeout(isScrollingProgrammatically._timeout);
    isScrollingProgrammatically._timeout = setTimeout(() => {
      isScrollingProgrammatically = false;
    }, 600);
  }

  /**
   * Scroll to the current page (called as render callback from sidebar).
   */
  function scrollToCurrentPage() {
    const tab = getActiveTab();
    if (!tab) return;
    scrollToPage(tab.currentPage, true);
  }

  /**
   * Navigate to next page by scrolling.
   */
  function scrollToNextPage() {
    const tab = getActiveTab();
    if (!tab || tab.currentPage >= tab.totalPages) return false;
    scrollToPage(tab.currentPage + 1, true);
    return true;
  }

  /**
   * Navigate to previous page by scrolling.
   */
  function scrollToPrevPage() {
    const tab = getActiveTab();
    if (!tab || tab.currentPage <= 1) return false;
    scrollToPage(tab.currentPage - 1, true);
    return true;
  }

  /**
   * Jump to a specific page number (used by sidebar thumbnails and keyboard nav).
   */
  function goToPageAndScroll(pageNum) {
    const tab = getActiveTab();
    if (!tab) return false;
    if (pageNum < 1 || pageNum > tab.totalPages) return false;
    scrollToPage(pageNum, true);
    return true;
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

    // Get the overlay for the current page
    const pageNum = tab.currentPage;
    const pw = pageWrappers.get(pageNum);
    if (!pw) {
      alert('Page not rendered yet.');
      return;
    }

    const overlay = pw.overlay;
    const canvas = pw.canvas;

    const img = new Image();
    img.onload = () => {
      const overlayWidth = overlay.clientWidth || canvas.width || 600;
      const overlayHeight = overlay.clientHeight || canvas.height || 800;

      const sigWidth = Math.min(img.width * 0.5, overlayWidth * 0.4);
      const sigHeight = (sigWidth / img.width) * img.height;

      const sig = {
        id: placedSigIdCounter++,
        page: pageNum,
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
      renderPlaceSignatureOnOverlay(sig, overlay);
    };
    img.src = dataUrl;
  }

  function renderPlaceSignatureOnOverlay(sig, overlay) {
    const el = document.createElement('div');
    el.className = 'placed-signature';
    el.dataset.sigId = sig.id;
    el.dataset.page = sig.page;
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
      const rect = el.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
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

    overlay.appendChild(el);
  }

  function updateSigPositions() {
    const tab = getActiveTab();
    if (!tab) return;

    for (const [pageNum, pw] of pageWrappers) {
      const els = pw.overlay.querySelectorAll('.placed-signature');
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
  // Save Signed PDF
  // ============================================================
  async function saveSignedPdf() {
    try {
      const tab = getActiveTab();
      if (!tab || !pdfTabs) {
        console.error('[saveSignedPdf] No active tab');
        return;
      }

      const signatures = getTabSignatures(tab);
      if (signatures.length === 0) {
        // Save original PDF if no signatures
        console.log('[saveSignedPdf] No signatures — saving original PDF');
        const saved = await ipcRenderer.invoke('esign:save-pdf', tab.base64);
        if (saved) {
          pdfTabs.setTabDirty(tab.id, false);
        }
        return;
      }

      console.log(`[saveSignedPdf] Processing ${signatures.length} signature(s) for tab "${tab.fileName}"`);
      console.log(`[saveSignedPdf] PDF base64 length: ${tab.base64 ? tab.base64.length : 'MISSING'}`);

      if (!tab.base64) {
        alert('PDF data is not available. Please re-open the file.');
        return;
      }

      const pdfBytesLoad = Buffer.from(tab.base64, 'base64');
      console.log(`[saveSignedPdf] Loaded PDF bytes: ${pdfBytesLoad.length}`);

      const pdfDocLib = await PDFDocument.load(pdfBytesLoad, {
        ignoreEncryption: true,
      });
      console.log(`[saveSignedPdf] PDF loaded — ${pdfDocLib.getPageCount()} page(s)`);

      for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        console.log(`[saveSignedPdf] Embedding signature ${i + 1}/${signatures.length} on page ${sig.page}`);

        if (!sig.dataUrl || typeof sig.dataUrl !== 'string') {
          console.error(`[saveSignedPdf] Invalid dataUrl for signature ${i}`);
          continue;
        }

        const page = pdfDocLib.getPage(sig.page - 1);
        const { width: pageWidth, height: pageHeight } = page.getSize();

        // Get canvas dimensions from the page wrapper
        const pw = pageWrappers.get(sig.page);
        if (!pw) {
          console.error(`[saveSignedPdf] Page wrapper not found for page ${sig.page}`);
          continue;
        }

        const canvasWidth = pw.canvas.width;
        const canvasHeight = pw.canvas.height;

        if (!canvasWidth || !canvasHeight) {
          console.error('[saveSignedPdf] Canvas dimensions are zero — cannot compute coordinates');
          continue;
        }

        const xRatio = pageWidth / canvasWidth;
        const yRatio = pageHeight / canvasHeight;

        const pdfX = sig.x * xRatio;
        const pdfY = pageHeight - (sig.y * yRatio) - (sig.height * yRatio);
        const pdfW = sig.width * xRatio;
        const pdfH = sig.height * yRatio;

        console.log(`[saveSignedPdf]  Page: ${pageWidth}x${pageHeight}, Canvas: ${canvasWidth}x${canvasHeight}`);
        console.log(`[saveSignedPdf]  Signature pos: (${sig.x},${sig.y}), size: ${sig.width}x${sig.height}`);
        console.log(`[saveSignedPdf]  PDF pos: (${pdfX.toFixed(1)},${pdfY.toFixed(1)}), size: ${pdfW.toFixed(1)}x${pdfH.toFixed(1)}`);

        // Safely extract the base64 data portion of the data URL
        const commaIndex = sig.dataUrl.indexOf(',');
        if (commaIndex === -1) {
          console.error(`[saveSignedPdf] Invalid data URL format for signature ${i}`);
          continue;
        }
        const imageBase64 = sig.dataUrl.substring(commaIndex + 1);
        const imageBytes = base64ToBytes(imageBase64);

        let image;
        try {
          if (sig.dataUrl.startsWith('data:image/png')) {
            image = await pdfDocLib.embedPng(imageBytes);
          } else if (sig.dataUrl.startsWith('data:image/jpeg') || sig.dataUrl.startsWith('data:image/jpg')) {
            image = await pdfDocLib.embedJpg(imageBytes);
          } else {
            // Fallback: try PNG first, then JPEG
            console.warn(`[saveSignedPdf] Unknown image type, trying PNG embed`);
            image = await pdfDocLib.embedPng(imageBytes);
          }
          console.log(`[saveSignedPdf]  Image embedded successfully (${image.width}x${image.height})`);
        } catch (embedErr) {
          console.error(`[saveSignedPdf] Failed to embed image: ${embedErr.message}`);
          // Try JPEG as fallback
          try {
            image = await pdfDocLib.embedJpg(imageBytes);
            console.log(`[saveSignedPdf]  Fallback JPEG embed succeeded`);
          } catch (embedErr2) {
            console.error(`[saveSignedPdf] Fallback embed also failed: ${embedErr2.message}`);
            alert(`Failed to embed signature ${i + 1}. The image format may be unsupported.`);
            continue;
          }
        }

        page.drawImage(image, {
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH,
          opacity: 0.92,
        });
        console.log(`[saveSignedPdf]  Image drawn on page successfully`);
      }

      console.log('[saveSignedPdf] Saving modified PDF...');
      const pdfBytes = await pdfDocLib.save();
      console.log(`[saveSignedPdf] Saved PDF bytes: ${pdfBytes.length}`);

      const base64 = Buffer.from(pdfBytes).toString('base64');
      console.log(`[saveSignedPdf] Encoded to base64: ${base64.length} chars`);

      const saved = await ipcRenderer.invoke('esign:save-pdf', base64);
      if (saved) {
        pdfTabs.updateTabData(tab.id, base64);
        console.log('[saveSignedPdf] PDF saved successfully with signatures');
        alert('PDF saved with signatures!');
      } else {
        console.log('[saveSignedPdf] Save cancelled by user');
      }
    } catch (err) {
      console.error('[saveSignedPdf] Fatal error:', err);
      const devToolsShortcut = window.SmartPDF && window.SmartPDF.getDevToolsShortcut
        ? window.SmartPDF.getDevToolsShortcut()
        : window.SmartPDF.isMac ? 'Cmd+Opt+I' : 'Ctrl+Shift+I';
      alert(`Failed to save PDF: ${err.message}\n\nPlease open DevTools (${devToolsShortcut}) for detailed logs.`);
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
        // Find the overlay that contains this drag target
        const overlay = dragTarget.closest('.pdf-page-overlay');
        if (!overlay) return;
        const overlayRect = overlay.getBoundingClientRect();
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

    // Register with global page navigation sidebar
    if (typeof window.SmartPDF.setPageNav === 'function') {
      window.SmartPDF.setPageNav(pdfTabs, () => {
        scrollToCurrentPage();
      }, renderThumbnails);
    }

    console.log('eSign feature initialized with scrollable multi-page view');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();