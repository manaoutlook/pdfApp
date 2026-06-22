const { BrowserWindow, dialog } = require('electron');
const { openAndReadFile } = require('../utils/file-dialogs');
const fs = require('fs');
const path = require('path');

function register(ipcMain) {
  // Open file dialog for a single PDF
  ipcMain.handle('split:open-pdf', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return openAndReadFile(win, [{ name: 'PDF Files', extensions: ['pdf'] }], false);
  });

  // Choose output folder for split parts
  ipcMain.handle('split:choose-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = dialog.showOpenDialogSync(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose folder to save split PDF parts',
    });
    if (!result || result.length === 0) return null;
    return result[0];
  });

  // Save a single split part to the output folder
  ipcMain.handle('split:save-part', async (event, { base64, fileName, outputDir }) => {
    try {
      const filePath = path.join(outputDir, fileName);
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(filePath, buffer);
      return true;
    } catch (err) {
      console.error('[split] Failed to save part:', err);
      return false;
    }
  });
}

module.exports = { register };