const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', 'dist');
const INDEX = path.join(DIST, 'index.html');

// Single instance (field use — prevent double launch)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0F172A',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    autoHideMenuBar: true,
  });

  // Offline-first: load file:// dist, fallback to index.html for expo-router SPA routes
  const load = () => {
    if (fs.existsSync(INDEX)) win.loadFile(INDEX);
    else {
      dialog.showErrorBox('FieldOps', `Missing ${INDEX}\nRun: npm run build:web`);
      win.loadURL('data:text/html,<h1 style="font-family:sans-serif;padding:40px">FieldOps — run npm run build:web first</h1>');
    }
  };
  load();

  // SPA fallback: expo-router history pushState → file not found → reload index
  win.webContents.on('did-fail-load', (_e, _code, _desc, url) => {
    if (url.startsWith('file://') && !url.endsWith('index.html') && fs.existsSync(INDEX)) {
      win.loadFile(INDEX);
    }
  });

  // Open external links (Stripe, maps, WhatsApp) in OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) { require('electron').shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
