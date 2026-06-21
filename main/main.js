const { app, BrowserWindow, ipcMain, nativeImage, Menu } = require('electron');

// MUST be called immediately after require, before anything else — sets the macOS menu bar name
app.setName('SmartPDF');

// Platform detection
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

const path = require('path');
const fs = require('fs');

let mainWindow;

// Build a cross-platform application menu that shows "SmartPDF" instead of "Electron"
function buildAppMenu() {
  // Shared "Edit" menu — identical across all platforms
  const editMenu = {
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
  };

  // Shared "View" menu — identical across all platforms
  const viewMenu = {
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
  };

  if (isMac) {
    // macOS menu — standard macOS patterns (app menu + Window menu)
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
      editMenu,
      viewMenu,
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
  } else {
    // Windows / Linux menu — File/Edit/View/Help pattern
    const template = [
      {
        label: 'File',
        submenu: [
          { role: 'quit', label: 'Exit' },
        ],
      },
      editMenu,
      viewMenu,
      {
        label: 'Help',
        submenu: [
          {
            label: 'About SmartPDF',
            accelerator: 'F1',
            click: () => {
              const { dialog } = require('electron');
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'About SmartPDF',
                message: 'SmartPDF v1.0.0',
                detail: 'Desktop PDF application with preview, eSign, and compression.\n\nCross-platform — runs on Windows, macOS, and Linux.',
              });
            },
          },
          { type: 'separator' },
          { role: 'toggleDevTools', label: 'Developer Tools' },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
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
  // Build cross-platform application menu showing "SmartPDF" instead of "Electron"
  buildAppMenu();

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
