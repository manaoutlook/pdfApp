// ============================================================
// SmartPDF - Shared Status Bar
// Provides pagination, zoom, and fit controls.
// Persists across all features; managed by main.js.
// ============================================================

(function() {
  'use strict';

  const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
  const DEFAULT_SCALE = 1.0;

  /**
   * StatusBar — a global bottom toolbar for pagination / zoom / fit.
   *
   * Usage (from main.js):
   *   statusBar = new StatusBar();
   *   statusBar.onPrevPage = () => { … };
   *   statusBar.onNextPage = () => { … };
   *   statusBar.onZoomChange = (scale, mode) => { … };
   */
  class StatusBar {
    constructor() {
      this.scale = DEFAULT_SCALE;
      this.totalPages = 0;
      this.currentPage = 1;

      // Callbacks set by main.js or feature modules
      this.onPrevPage = null;
      this.onNextPage = null;
      this.onZoomChange = null; // (scale, mode) => void

      this._cacheDom();
      this._bindEvents();
    }

    _cacheDom() {
      this.bar = document.getElementById('globalStatusBar');
      this.btnPrevPage = document.getElementById('statusBtnPrevPage');
      this.btnNextPage = document.getElementById('statusBtnNextPage');
      this.pageInfo = document.getElementById('statusPageInfo');
      this.btnZoomOut = document.getElementById('statusBtnZoomOut');
      this.btnZoomIn = document.getElementById('statusBtnZoomIn');
      this.zoomLabel = document.getElementById('statusZoomLabel');
      this.btnFitPage = document.getElementById('statusBtnFitPage');
      this.btnFitHeight = document.getElementById('statusBtnFitHeight');
      this.btnFitWidth = document.getElementById('statusBtnFitWidth');
      this.btnActualSize = document.getElementById('statusBtnActualSize');
    }

    _bindEvents() {
      this.btnPrevPage.addEventListener('click', () => {
        if (typeof this.onPrevPage === 'function') this.onPrevPage();
      });
      this.btnNextPage.addEventListener('click', () => {
        if (typeof this.onNextPage === 'function') this.onNextPage();
      });
      this.btnZoomOut.addEventListener('click', () => this._changeZoom(-1));
      this.btnZoomIn.addEventListener('click', () => this._changeZoom(1));
      this.btnFitPage.addEventListener('click', () => this._fireFitChange('fitPage'));
      this.btnFitHeight.addEventListener('click', () => this._fireFitChange('fitHeight'));
      this.btnFitWidth.addEventListener('click', () => this._fireFitChange('fitWidth'));
      this.btnActualSize.addEventListener('click', () => this._fireFitChange('actual'));
    }

    // ============================================================
    // Public API — called by main.js / features
    // ============================================================

    /** Show the status bar */
    show() {
      this.bar.classList.remove('hidden');
    }

    /** Hide the status bar */
    hide() {
      this.bar.classList.add('hidden');
    }

    /** Update page info display */
    setPage(currentPage, totalPages) {
      this.currentPage = currentPage || 1;
      this.totalPages = totalPages || 0;
      this.pageInfo.textContent = totalPages > 0
        ? `Page ${this.currentPage} / ${this.totalPages}`
        : 'Page — / —';
      this.btnPrevPage.disabled = this.currentPage <= 1;
      this.btnNextPage.disabled = this.currentPage >= this.totalPages || this.totalPages === 0;
    }

    /** Update zoom label and button states */
    setZoom(scale) {
      this.scale = scale;
      const pct = Math.round(scale * 100);
      this.zoomLabel.textContent = pct + '%';
    }

    /** Update zoom button disabled states */
    updateZoomButtons(scale) {
      this.btnZoomOut.disabled = scale <= ZOOM_STEPS[0];
      this.btnZoomIn.disabled = scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
    }

    /** Enable/disable all fit buttons */
    setFitEnabled(enabled) {
      this.btnFitPage.disabled = !enabled;
      this.btnFitHeight.disabled = !enabled;
      this.btnFitWidth.disabled = !enabled;
      this.btnActualSize.disabled = !enabled;
    }

    /** Get the next stepped zoom level */
    static getNextZoomStep(currentScale, direction) {
      const currentPct = Math.round(currentScale * 100);
      if (direction > 0) {
        for (const step of ZOOM_STEPS) {
          if (Math.round(step * 100) > currentPct) return step;
        }
        return ZOOM_STEPS[ZOOM_STEPS.length - 1];
      } else {
        for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
          if (Math.round(ZOOM_STEPS[i] * 100) < currentPct) return ZOOM_STEPS[i];
        }
        return ZOOM_STEPS[0];
      }
    }

    // ============================================================
    // Private
    // ============================================================
    _changeZoom(direction) {
      const newScale = StatusBar.getNextZoomStep(this.scale, direction);
      this.scale = newScale;
      this.setZoom(newScale);
      this.updateZoomButtons(newScale);
      if (typeof this.onZoomChange === 'function') {
        this.onZoomChange(newScale, 'custom');
      }
    }

    _fireFitChange(mode) {
      if (typeof this.onZoomChange === 'function') {
        this.onZoomChange(this.scale, mode);
      }
    }
  }

  // Export to window
  if (!window.SmartPDF) window.SmartPDF = {};
  window.SmartPDF.StatusBar = StatusBar;

  console.log('Shared StatusBar module loaded');
})();