// ============================================================
// SmartPDF - Shared Continuous PDF Viewer
// Renders ALL pages of a PDF in a vertically scrollable container
// with IntersectionObserver-based page tracking.
//
// Used by: Preview, eSign, Compress (and any future viewer feature)
// ============================================================

(function() {
  'use strict';

  const pdfjsLib = require('pdfjs-dist');

  /**
   * ContinuousPdfViewer - renders all pages of a PDF into a scroll container.
   *
   * @param {Object} options
   * @param {HTMLElement} options.scrollContainerEl - The scrollable div where pages go
   * @param {Object} options.pdfTabs - The shared PdfTabs instance (or compatible API)
   * @param {number} [options.scale=1.5] - Render scale (1.0 = 72 DPI)
   * @param {Function} [options.onPageChange] - Called when visible page changes: (pageNum, tab) => void
   * @param {Function} [options.onPageRendered] - Called after each page renders: (pageNum, wrapperEl, canvasEl) => void
   * @param {Function} [options.overlayFactory] - Called to create an overlay element per page: (pageNum) => HTMLElement | null
   */
  class ContinuousPdfViewer {
    constructor(options) {
      this.scrollContainerEl = options.scrollContainerEl;
      this.pdfTabs = options.pdfTabs;
      this.scale = options.scale || 1.5;
      this.onPageChange = options.onPageChange || (() => {});
      this.onPageRendered = options.onPageRendered || (() => {});
      this.overlayFactory = options.overlayFactory || null;

      // pageNum -> { wrapper, canvas, overlay }
      this.pageWrappers = new Map();
      this.intersectionObserver = null;
      this.isScrollingProgrammatically = false;

      // Bind methods
      this.renderAllPages = this.renderAllPages.bind(this);
      this.clearAllPages = this.clearAllPages.bind(this);
      this.scrollToPage = this.scrollToPage.bind(this);
      this.goToPage = this.goToPage.bind(this);
      this.nextPage = this.nextPage.bind(this);
      this.prevPage = this.prevPage.bind(this);
      this.getActivePage = this.getActivePage.bind(this);
    }

    /**
     * Get the currently active tab from pdfTabs.
     */
    getActiveTab() {
      return this.pdfTabs ? this.pdfTabs.getActiveTab() : null;
    }

    /**
     * Get the page number currently considered "active" based on scroll position.
     */
    getActivePage() {
      const tab = this.getActiveTab();
      return tab ? tab.currentPage : 1;
    }

    /**
     * Get the map of page wrappers (for external use, e.g., placing overlays).
     */
    getPageWrappers() {
      return this.pageWrappers;
    }

    /**
     * Get the wrapper for a specific page.
     */
    getPageWrapper(pageNum) {
      return this.pageWrappers.get(pageNum) || null;
    }

    /**
     * Clear all rendered pages from the container.
     */
    clearAllPages() {
      if (this.scrollContainerEl) {
        this.scrollContainerEl.innerHTML = '';
      }
      this.pageWrappers = new Map();
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect();
        this.intersectionObserver = null;
      }
    }

    /**
     * Render ALL pages of the given tab into the scroll container.
     * @param {Object} tab - The PdfTabs tab object
     */
    async renderAllPages(tab) {
      if (!tab || !tab.pdfDoc || !this.scrollContainerEl) return;

      this.clearAllPages();

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

        // Optionally create an overlay
        if (typeof this.overlayFactory === 'function') {
          const overlay = this.overlayFactory(i);
          if (overlay) {
            overlay.className = (overlay.className || '') + ' pdf-page-overlay';
            wrapper.appendChild(overlay);
          }
        }

        this.scrollContainerEl.appendChild(wrapper);

        // Store references
        const entry = { wrapper, canvas };
        this.pageWrappers.set(i, entry);

        // Render the page into the canvas
        try {
          const page = await tab.pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale: this.scale });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;

          // Notify callback
          this.onPageRendered(i, wrapper, canvas);
        } catch (err) {
          console.error(`[ContinuousPdfViewer] Failed to render page ${i}:`, err);
        }
      }

      // Set up IntersectionObserver to detect which page is visible
      this._setupIntersectionObserver(tab);

      // Scroll to the current page
      this.scrollToPage(tab.currentPage, false);
    }

    /**
     * Re-render all pages at the current scale (used after zoom changes).
     */
    async refreshScale(newScale) {
      this.scale = newScale;
      const tab = this.getActiveTab();
      if (!tab) return;
      const currentPage = tab.currentPage;
      await this.renderAllPages(tab);
      tab.currentPage = currentPage;
      this.scrollToPage(currentPage, false);
    }

    /**
     * Set up IntersectionObserver to track which page is most visible.
     */
    _setupIntersectionObserver(tab) {
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect();
      }

      // Threshold map: pageNum -> visible ratio
      const visibilityMap = new Map();
      const self = this;

      this.intersectionObserver = new IntersectionObserver((entries) => {
        if (self.isScrollingProgrammatically) return;

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
          self.onPageChange(bestPage, tab);
        }
      }, {
        root: this.scrollContainerEl,
        threshold: [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1],
      });

      for (const [pageNum, pw] of this.pageWrappers) {
        this.intersectionObserver.observe(pw.wrapper);
      }
    }

    /**
     * Scroll to a specific page.
     * @param {number} pageNum
     * @param {boolean} smooth - whether to animate smoothly
     */
    scrollToPage(pageNum, smooth) {
      const pw = this.pageWrappers.get(pageNum);
      if (!pw) return;

      const tab = this.getActiveTab();
      if (tab) {
        tab.currentPage = pageNum;
      }

      this.isScrollingProgrammatically = true;
      pw.wrapper.scrollIntoView({
        block: 'start',
        behavior: smooth !== false ? 'smooth' : 'auto',
      });

      // Reset the flag after the scroll animation completes
      clearTimeout(this._scrollTimeout);
      this._scrollTimeout = setTimeout(() => {
        this.isScrollingProgrammatically = false;
      }, 600);
    }

    /**
     * Navigate to a specific page (for sidebar/thumbnails).
     */
    goToPage(pageNum) {
      const tab = this.getActiveTab();
      if (!tab) return false;
      if (pageNum < 1 || pageNum > tab.totalPages) return false;
      this.scrollToPage(pageNum, true);
      return true;
    }

    /**
     * Go to next page.
     */
    nextPage() {
      const tab = this.getActiveTab();
      if (!tab || tab.currentPage >= tab.totalPages) return false;
      this.scrollToPage(tab.currentPage + 1, true);
      return true;
    }

    /**
     * Go to previous page.
     */
    prevPage() {
      const tab = this.getActiveTab();
      if (!tab || tab.currentPage <= 1) return false;
      this.scrollToPage(tab.currentPage - 1, true);
      return true;
    }

    /**
     * Destroy the viewer and clean up.
     */
    destroy() {
      this.clearAllPages();
      if (this.intersectionObserver) {
        this.intersectionObserver.disconnect();
        this.intersectionObserver = null;
      }
    }
  }

  // Export to window for shared access
  if (!window.SmartPDF) window.SmartPDF = {};
  window.SmartPDF.ContinuousPdfViewer = ContinuousPdfViewer;

  console.log('Shared ContinuousPdfViewer module loaded');
})();