// ============================================================
// SmartPDF — Shared Thumbnail Renderer
// Extracted from preview, esign, and compress to eliminate
// duplicated renderThumbnails / renderThumbnailPage logic.
// ============================================================

(function () {
  'use strict';

  /**
   * Renders page thumbnails for a PdfTabs active tab into the
   * provided container element.
   *
   * @param {object}             pdfTabs  — PdfTabs singleton
   * @param {HTMLElement}        container — thumbnails container (usually #pageNavThumbnails)
   */
  async function renderThumbnails(pdfTabs, container) {
    if (!pdfTabs || !container) return;
    const tab = pdfTabs.getActiveTab();
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
      label.textContent = 'Page ' + i;
      item.appendChild(label);

      container.appendChild(item);

      // Render asynchronously — each thumbnail resolves independently
      renderThumbnailPage(tab, i, canvas);
    }
  }

  /**
   * Renders a single page thumbnail onto the given canvas.
   *
   * @param {object}      tab      — active tab (must have .pdfDoc)
   * @param {number}      pageNum  — 1‑based page number
   * @param {HTMLCanvasElement} canvas
   */
  async function renderThumbnailPage(tab, pageNum, canvas) {
    try {
      const page = await tab.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.15 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;
    } catch (_err) {
      // Silently skip thumbnails that fail to render
    }
  }

  // ============================================================
  // Expose on SmartPDF namespace
  // ============================================================
  if (!window.SmartPDF) window.SmartPDF = {};
  window.SmartPDF.renderThumbnails = renderThumbnails;
  window.SmartPDF.renderThumbnailPage = renderThumbnailPage;
})();