const { BrowserWindow } = require('electron');
const { openAndReadFile, saveBase64File } = require('../utils/file-dialogs');

function register(ipcMain) {
  // Open file dialog for PDF (multi-select)
  ipcMain.handle('merge:open-pdf', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return openAndReadFile(win, [{ name: 'PDF Files', extensions: ['pdf'] }], true);
  });

  // Save merged PDF
  ipcMain.handle('merge:save-pdf', async (event, base64Pdf) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return saveBase64File(win, [{ name: 'PDF Files', extensions: ['pdf'] }], base64Pdf);
  });
}

module.exports = { register };