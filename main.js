const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'PDF Signer',
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Open file dialog for PDF
ipcMain.handle('open-pdf', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const data = fs.readFileSync(filePath);
  return { filePath, data: data.toString('base64') };
});

// Open file dialog for signature image
ipcMain.handle('open-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const data = fs.readFileSync(filePath);
  return { filePath, data: data.toString('base64') };
});

// Save signed PDF
ipcMain.handle('save-pdf', async (event, base64Pdf) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  if (result.canceled) return false;

  const pdfBuffer = Buffer.from(base64Pdf, 'base64');
  fs.writeFileSync(result.filePath, pdfBuffer);
  return true;
});