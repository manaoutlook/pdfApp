const { BrowserWindow } = require('electron');
const fs = require('fs');
const { openAndReadFile } = require('../utils/file-dialogs');

function register(ipcMain) {
  // Open file dialog for PDF (multi-select)
  ipcMain.handle('preview:open-pdf', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return openAndReadFile(win, [{ name: 'PDF Files', extensions: ['pdf'] }], true);
  });

  // Read a PDF file by absolute path (for re-opening recent files)
  ipcMain.handle('preview:read-file-by-path', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) {
        console.warn(`[preview-handler] File not found: ${filePath}`);
        return null;
      }
      const data = fs.readFileSync(filePath);
      return { filePath, data: data.toString('base64') };
    } catch (err) {
      console.error(`[preview-handler] Failed to read file: ${filePath}`, err);
      return null;
    }
  });
}

module.exports = { register };