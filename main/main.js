const { app, BrowserWindow, ipcMain, nativeImage, Menu } = require('electron');

// MUST be called immediately after require, before anything else — sets the macOS menu bar name
app.setName('SmartPDF');

const path = require('path');
const fs = require('fs');

let mainWindow;

// Build a custom macOS menu bar that shows "SmartPDF" instead of "Electron"
function buildMacMenu() {
  const isMac = process.platform === 'darwin';
  if (!isMac) return;

  const template = [
    {
      label: 'SmartPDF',
      submenu: [
        { label: 'About SmartPDF', role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  // Use .ico for Windows, .png for macOS/Linux (macOS dock requires PNG)
  const iconFile = process.platform === 'win32' ? 'logo.ico' : 'logo.png';
  const iconPath = path.join(__dirname, '..', 'assets', iconFile);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'SmartPDF',
    icon: iconPath,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Build custom macOS menu bar showing "SmartPDF" instead of "Electron"
  buildMacMenu();

  // Set the dock icon on macOS (PNG works best with Electron's nativeImage)
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, '..', 'assets', 'logo.png');
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    app.dock.setIcon(dockIcon);
    console.log('Dock icon set from logo.png');
  }

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