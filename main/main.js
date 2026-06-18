const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'SmartPDF',
    icon: path.join(__dirname, '..', 'assets', 'logo.ico'),
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Load all IPC handlers from the ipc-handlers directory
  const handlersDir = path.join(__dirname, 'ipc-handlers');
  if (fs.existsSync(handlersDir)) {
    const handlerFiles = fs.readdirSync(handlersDir).filter(f => f.endsWith('-handler.js'));
    handlerFiles.forEach(file => {
      const handler = require(path.join(handlersDir, file));
      if (typeof handler.register === 'function') {
        handler.register(ipcMain);
        console.log(`Registered IPC handler: ${file}`);
      }
    });
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});