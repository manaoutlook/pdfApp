const { BrowserWindow } = require('electron');
const { openAndReadFile, saveBase64File } = require('../utils/file-dialogs');

function register(ipcMain) {
  // Open file dialog for PDF
  ipcMain.handle('esign:open-pdf', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return openAndReadFile(win, [{ name: 'PDF Files', extensions: ['pdf'] }]);
  });

  // Open file dialog for signature image
  ipcMain.handle('esign:open-image', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return openAndReadFile(win, [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] }]);
  });

  // Save signed PDF
  ipcMain.handle('esign:save-pdf', async (event, base64Pdf) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return saveBase64File(win, [{ name: 'PDF Files', extensions: ['pdf'] }], base64Pdf);
  });
}

module.exports = { register };