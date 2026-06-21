const { app, BrowserWindow, ipcMain, nativeImage, Menu } = require('electron');

// MUST be called immediately after require, before anything else — sets the macOS menu bar name
app.setName('SmartPDF');

// Platform detection
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

const path = require('path');
const fs = require('fs');

let mainWindow;

// Build a custom macOS menu bar that shows "SmartPDF" instead of "Electron"
function buildMacMenu() {
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
  // Use .ico for Windows, .png for macOS/Linux
  // On macOS the dock uses PNG for nativeImage; on Linux .png is standard
  const iconFile = isWindows ? 'logo.ico' : 'logo.png';
  const iconPath = path.join(__dirname, '..', 'assets', iconFile);
  
  // On Linux, set the window icon explicitly (required on many DEs like GNOME/KDE)
  const icon = nativeImage.createFromPath(iconPath);
  const iconForWindow = isWindows ? iconPath : icon;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'SmartPDF',
    icon: iconForWindow,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Build custom macOS menu bar showing "SmartPDF" instead of "Electron"
  buildMacMenu();

  // Set the dock icon on macOS (PNG works best with Electron's nativeImage)
  if (isMac && app.dock) {
    const dockIconPath = path.join(__dirname, '..', 'assets', 'logo.png');
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    app.dock.setIcon(dockIcon);
    console.log('Mac Dock icon set from logo.png');
  }
  
  // On Windows, set the app user model ID for proper taskbar grouping
  if (isWindows) {
    app.setAppUserModelId('com.smartpdf.app');
    console.log('Windows detected: AppUserModelId set for taskbar integration');
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
  // On macOS, keep the app running when all windows are closed (standard macOS behavior)
  // On Windows and Linux, quit the app when all windows are closed
  if (!isMac) app.quit();
});

app.on('before-quit', () => {
  // Ensure the app actually exits on quit (handles Cmd+Q on macOS)
  console.log('SmartPDF is quitting...');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
