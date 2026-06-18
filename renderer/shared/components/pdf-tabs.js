// ============================================================
// SmartPDF - Shared PDF Tab Manager
// All features (eSign, Compress, Convert, Split, Merge, etc.)
// use this component for centralized multi-file management.
// Max 20 tabs open at once.
// ============================================================

(function() {
  'use strict';

  const { Buffer } = require('buffer');
  const pdfjsLib = require('pdfjs-dist');

  // Set worker path once globally
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/build/pdf.worker.entry');
  }

  const MAX_TABS = 20;

  class PdfTabs {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.tabBarEl - The tab bar container element
     * @param {HTMLElement} options.tabScrollEl - The tab scroll container element
     * @param {Function} options.onTabSwitch - Called when active tab changes: (tab) => void
     * @param {Function} options.onTabClose - Called when a tab is closed: (tabId) => void
     * @param {Function} options.onDocumentLoad - Called after pdfjs doc is loaded: (tab) => void
     */
    constructor(options) {
      this.tabBarEl = options.tabBarEl;
      this.tabScrollEl = options.tabScrollEl;
      this.onTabSwitch = options.onTabSwitch || (() => {});
      this.onTabClose = options.onTabClose || (() => {});
      this.onDocumentLoad = options.onDocumentLoad || (() => {});

      this.tabs = [];
      this.activeTabId = null;
      this.tabIdCounter = 0;

      // Bind methods
      this.switchTab = this.switchTab.bind(this);
      this.closeTab = this.closeTab.bind(this);
      this.render = this.render.bind(this);

      // Hide tab bar initially
      if (this.tabBarEl) {
        this.tabBarEl.style.display = 'none';
      }

      console.log('PdfTabs component initialized');
    }

    /**
     * Get the currently active tab object.
     * @returns {Object|null}
     */
    getActiveTab() {
      return this.tabs.find(t => t.id === this.activeTabId) || null;
    }

    /**
     * Get a tab by its ID.
     * @param {number} tabId
     * @returns {Object|null}
     */
    getTab(tabId) {
      return this.tabs.find(t => t.id === tabId) || null;
    }

    /**
     * Get all tabs.
     * @returns {Array}
     */
    getAllTabs() {
      return this.tabs.filter(t => !t.disposed);
    }

    /**
     * Check if a file is already open.
     * @param {string} filePath
     * @returns {boolean}
     */
    isFileOpen(filePath) {
      return this.tabs.some(t => t.filePath === filePath && !t.disposed);
    }

    /**
     * Get total open tab count.
     * @returns {number}
     */
    getTabCount() {
      return this.tabs.filter(t => !t.disposed).length;
    }

    /**
     * Open one or more PDF files.
     * @param {Array|Object} files - Array of {filePath, data} or single {filePath, data}
     */
    openFiles(files) {
      if (!files) return;
      if (!Array.isArray(files)) {
        files = [files];
      }
      for (const file of files) {
        if (this.getTabCount() >= MAX_TABS) {
          alert(`Maximum of ${MAX_TABS} PDFs can be open at once. Please close a tab first.`);
          break;
        }
        this._openSingleFile(file.filePath, file.data);
      }
    }

    /**
     * Open a single PDF from a File object (drag-drop).
     * @param {File} file - HTML File object
     * @param {Function} callback - Called with (tab) after loaded
     */
    openFileFromDrop(file, callback) {
      if (this.getTabCount() >= MAX_TABS) {
        alert(`Maximum of ${MAX_TABS} PDFs can be open at once. Please close a tab first.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = Buffer.from(e.target.result).toString('base64');
        const tab = this._createTab(file.name, base64);
        this.activeTabId = tab.id;
        this.render();
        this._loadDocument(tab, callback);
      };
      reader.readAsArrayBuffer(file);
    }

    /**
     * Switch to a specific tab by ID.
     * @param {number} tabId
     */
    switchTab(tabId) {
      if (tabId === this.activeTabId) return;
      const tab = this.tabs.find(t => t.id === tabId);
      if (!tab || tab.disposed) return;

      // Dispose the current pdfjs document to free memory
      const current = this.getActiveTab();
      if (current && current.pdfDoc) {
        this._disposeDocument(current);
      }

      this.activeTabId = tab.id;
      this.render();

      // Lazy load the document if not loaded
      if (!tab.pdfDoc && tab.base64) {
        this._loadDocument(tab);
      } else {
        this.onTabSwitch(tab);
      }
    }

    /**
     * Close a tab by ID.
     * @param {number} tabId
     */
    closeTab(tabId) {
      const tab = this.tabs.find(t => t.id === tabId);
      if (!tab) return;

      this._disposeDocument(tab);
      tab.disposed = true;
      tab.base64 = null; // Free memory

      this.tabs = this.tabs.filter(t => t.id !== tabId);

      if (this.tabs.length === 0) {
        this.activeTabId = null;
        this.tabBarEl.style.display = 'none';
        this.render();
        this.onTabClose(tabId);
        return;
      }

      // Switch to the next available tab
      if (this.activeTabId === tabId) {
        const nextTab = this.tabs[0];
        this.activeTabId = nextTab.id;
        this.render();
        this._loadDocument(nextTab);
      } else {
        this.render();
      }
      this.onTabClose(tabId);
    }

    /**
     * Close all tabs.
     */
    closeAllTabs() {
      for (const tab of this.tabs) {
        this._disposeDocument(tab);
        tab.disposed = true;
        tab.base64 = null;
      }
      this.tabs = [];
      this.activeTabId = null;
      if (this.tabBarEl) this.tabBarEl.style.display = 'none';
      this.render();
    }

    /**
     * Mark a tab as having unsaved changes.
     * @param {number} tabId
     * @param {boolean} dirty
     */
    setTabDirty(tabId, dirty) {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.dirty = dirty;
        this.render();
      }
    }

    /**
     * Update a tab's base64 data after saving.
     * @param {number} tabId
     * @param {string} newBase64
     */
    updateTabData(tabId, newBase64) {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.base64 = newBase64;
        tab.dirty = false;
        this.render();
      }
    }

    /**
     * Navigate to a specific page in the active tab.
     * @param {number} pageNum
     */
    goToPage(pageNum) {
      const tab = this.getActiveTab();
      if (!tab || !tab.pdfDoc) return false;
      if (pageNum < 1 || pageNum > tab.totalPages) return false;
      tab.currentPage = pageNum;
      return true;
    }

    /**
     * Go to the next page.
     * @returns {boolean}
     */
    nextPage() {
      const tab = this.getActiveTab();
      if (tab && tab.currentPage < tab.totalPages) {
        tab.currentPage++;
        return true;
      }
      return false;
    }

    /**
     * Go to the previous page.
     * @returns {boolean}
     */
    prevPage() {
      const tab = this.getActiveTab();
      if (tab && tab.currentPage > 1) {
        tab.currentPage--;
        return true;
      }
      return false;
    }

    // ============================================================
    // Private Methods
    // ============================================================

    _openSingleFile(filePath, base64) {
      // Check if file already open
      const existing = this.tabs.find(t => t.filePath === filePath && !t.disposed);
      if (existing) {
        this.switchTab(existing.id);
        return;
      }

      const tab = this._createTab(filePath, base64);
      this.activeTabId = tab.id;
      this.render();
      this._loadDocument(tab);
    }

    _createTab(filePath, base64) {
      const fileName = filePath.split(/[/\\]/).pop();
      const id = this.tabIdCounter++;
      const tab = {
        id,
        filePath,
        fileName,
        base64,
        pdfDoc: null,      // Lazy-loaded to save memory
        currentPage: 1,
        totalPages: 0,
        data: {},          // Feature-specific data (e.g. signatures for esign)
        dirty: false,
        disposed: false,
        createdAt: Date.now(),
      };
      this.tabs.push(tab);
      return tab;
    }

    async _loadDocument(tab, callback) {
      if (tab.disposed || !tab.base64) return;

      const pdfBytes = Buffer.from(tab.base64, 'base64');
      try {
        const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
        if (tab.disposed) {
          doc.destroy();
          return;
        }
        tab.pdfDoc = doc;
        tab.totalPages = doc.numPages;
        tab.currentPage = Math.min(tab.currentPage, tab.totalPages);
        this.render();
        this.onDocumentLoad(tab);
        this.onTabSwitch(tab);
        if (callback) callback(tab);
      } catch (err) {
        console.error('Failed to load PDF:', err);
        alert('Failed to load PDF: ' + err.message);
        this.closeTab(tab.id);
      }
    }

    _disposeDocument(tab) {
      if (tab.pdfDoc) {
        try {
          tab.pdfDoc.destroy();
        } catch (e) { /* ignore */ }
        tab.pdfDoc = null;
      }
    }

    /**
     * Render the tab bar. Called after every tab state change.
     */
    render() {
      if (!this.tabScrollEl || !this.tabBarEl) return;

      const visibleTabs = this.tabs.filter(t => !t.disposed);
      this.tabBarEl.style.display = visibleTabs.length > 0 ? 'flex' : 'none';
      this.tabScrollEl.innerHTML = '';

      visibleTabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = 'pdf-tab' + (tab.id === this.activeTabId ? ' active' : '');
        el.title = tab.filePath;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tab-name';
        nameSpan.textContent = tab.fileName;
        el.appendChild(nameSpan);

        if (tab.dirty) {
          const dirtyDot = document.createElement('span');
          dirtyDot.className = 'tab-dirty';
          dirtyDot.title = 'Contains unsaved changes';
          el.appendChild(dirtyDot);
        }

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        });
        el.appendChild(closeBtn);

        el.addEventListener('click', () => {
          this.switchTab(tab.id);
        });

        this.tabScrollEl.appendChild(el);
      });
    }
  }

  // Export to window for shared access
  if (!window.SmartPDF) window.SmartPDF = {};
  window.SmartPDF.PdfTabs = PdfTabs;
  window.SmartPDF.MAX_TABS = MAX_TABS;

  console.log('Shared PdfTabs module loaded');
})();