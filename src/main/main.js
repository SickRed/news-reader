'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
  shell,
  net,
  dialog,
  powerMonitor,
} = require('electron');
const { Engine } = require('./engine');
const { setFetch } = require('./fetchers');
const { loadUserConfig, resetUserConfig } = require('./config');
const { toOpml } = require('./opml');

const isMac = process.platform === 'darwin';
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const TICK_MS = 60e3;

let engine;
let tray;
let mainWindow;
let alertWindow;
let quitting = false;
let configPath;
let lastNag = 0;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
}

if (process.platform === 'win32') app.setAppUserModelId('de.code-alliance.it-updates');

// ---------------------------------------------------------------------------
// Tray icon: drawn at runtime so the app ships without binary assets.

function drawIcon(size, rgba, template) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size * 0.45;
  const inner = size * 0.27;
  const dot = size * 0.14;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const on = (d <= outer && d >= inner) || d <= dot;
      const i = (y * size + x) * 4;
      // BGRA
      buf[i] = rgba[2];
      buf[i + 1] = rgba[1];
      buf[i + 2] = rgba[0];
      buf[i + 3] = on ? 255 : 0;
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: size / 16 });
  if (template) img.setTemplateImage(true);
  return img;
}

const icons = {};
function trayIcon(alerting) {
  const key = alerting ? 'alert' : 'idle';
  if (!icons[key]) {
    const color = alerting ? [220, 38, 38] : isMac ? [0, 0, 0] : [90, 140, 255];
    icons[key] = drawIcon(isMac ? 32 : 16, color, isMac && !alerting);
  }
  return icons[key];
}

// ---------------------------------------------------------------------------
// Windows

function secureWebPrefs() {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true };
}

function blockNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 500,
    show: false,
    title: 'IT Updates',
    webPreferences: secureWebPrefs(),
  });
  blockNavigation(mainWindow);
  mainWindow.loadFile(path.join(RENDERER, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden') && !app.getLoginItemSettings().wasOpenedAsHidden) showMain();
  });
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
      if (isMac) app.dock?.hide();
    }
  });
}

function showMain(selectId) {
  if (!mainWindow) createMain();
  if (isMac) app.dock?.show();
  mainWindow.show();
  mainWindow.focus();
  if (selectId) mainWindow.webContents.send('select-item', selectId);
}

function createAlertWindow() {
  alertWindow = new BrowserWindow({
    width: 560,
    height: 520,
    minWidth: 420,
    minHeight: 300,
    show: false,
    title: 'IT Updates – Action required',
    alwaysOnTop: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    webPreferences: secureWebPrefs(),
  });
  alertWindow.setAlwaysOnTop(true, 'screen-saver');
  alertWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  blockNavigation(alertWindow);
  alertWindow.loadFile(path.join(RENDERER, 'alert.html'));
  // The alert can only go away by acknowledging every pending item.
  alertWindow.on('close', (e) => {
    if (!quitting && engine.pendingAlerts().length) {
      e.preventDefault();
      alertWindow.webContents.send('shake');
    }
  });
  alertWindow.on('closed', () => (alertWindow = null));
}

function showAlertWindow() {
  if (!alertWindow) createAlertWindow();
  const show = () => {
    alertWindow.webContents.send('state', engine.snapshot());
    alertWindow.show();
    alertWindow.moveTop();
    alertWindow.focus();
    if (isMac) app.dock?.bounce('critical');
    else alertWindow.flashFrame(true);
  };
  if (alertWindow.webContents.isLoading()) alertWindow.webContents.once('did-finish-load', show);
  else show();
  lastNag = Date.now();
}

function closeAlertWindowIfDone() {
  if (alertWindow && !engine.pendingAlerts().length) {
    alertWindow.flashFrame(false);
    alertWindow.destroy();
    alertWindow = null;
  }
}

// ---------------------------------------------------------------------------
// Alerts

function notify(items) {
  if (!Notification.isSupported()) return;
  const sound = engine.config.alerts?.sound !== false;
  const title = items.length === 1 ? `⚠️ ${items[0].sourceName}` : `⚠️ ${items.length} urgent IT updates`;
  const body = items.length === 1 ? items[0].title : items.slice(0, 3).map((i) => `• ${i.title}`).join('\n');
  const n = new Notification({
    title,
    body,
    silent: !sound,
    urgency: 'critical',
    timeoutType: 'never',
    sound: sound && isMac ? 'Sosumi' : undefined,
  });
  n.on('click', () => showAlertWindow());
  n.show();
}

function onAlert(items) {
  notify(items);
  showAlertWindow();
}

function nagIfPending() {
  const renag = (engine.config.alerts?.renagMinutes ?? 15) * 60e3;
  if (renag > 0 && engine.pendingAlerts().length && Date.now() - lastNag >= renag) {
    if (engine.config.alerts?.sound !== false) shell.beep();
    showAlertWindow();
  }
}

// ---------------------------------------------------------------------------
// Tray

function updateTray() {
  if (!tray) return;
  const pending = engine.pendingAlerts().length;
  const unreadHigh = engine.sortedItems().filter((i) => !i.read && (i.urgency === 'high' || i.urgency === 'critical')).length;
  tray.setImage(trayIcon(pending > 0));
  if (isMac) tray.setTitle(pending ? ` ${pending}` : '');
  tray.setToolTip(
    `IT Updates — ${pending} awaiting acknowledgement, ${unreadHigh} unread high/critical` +
      (engine.lastRefresh ? `\nLast refresh: ${new Date(engine.lastRefresh).toLocaleTimeString()}` : '')
  );
  const login = app.getLoginItemSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open IT Updates', click: () => showMain() },
      {
        label: pending ? `Review ${pending} urgent item(s)…` : 'No urgent items',
        enabled: pending > 0,
        click: () => showAlertWindow(),
      },
      { type: 'separator' },
      { label: engine.refreshing ? 'Refreshing…' : 'Refresh now', enabled: !engine.refreshing, click: () => engine.refresh({ force: true }) },
      { type: 'separator' },
      {
        label: 'Start at login',
        type: 'checkbox',
        checked: login.openAtLogin,
        click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked, openAsHidden: true, args: ['--hidden'] }),
      },
      { label: 'Edit sources & rules…', click: () => openConfig() },
      { label: 'Export feeds as OPML…', click: () => exportOpml() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
}

// ---------------------------------------------------------------------------
// Helpers

function openExternal(url) {
  if (/^https?:\/\//i.test(url || '')) shell.openExternal(url);
}

function openConfig() {
  shell.openPath(configPath);
}

async function exportOpml() {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export feeds as OPML',
    defaultPath: path.join(app.getPath('downloads'), 'it-updates-feeds.opml'),
    filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }],
  });
  if (!canceled && filePath) fs.writeFileSync(filePath, toOpml(engine.config));
}

function reloadConfig() {
  try {
    engine.setConfig(loadUserConfig(configPath));
    // Force a full re-fetch so new rules apply to existing items.
    for (const st of Object.values(engine.sourceState)) st.cache = null;
    engine.refresh({ force: true });
  } catch (err) {
    dialog.showErrorBox('IT Updates – config error', `${configPath}\n\n${err.message}`);
  }
}

// The engine emits 'updated' once per fetched source; coalesce those into one UI push.
let broadcastTimer = null;
function scheduleBroadcast() {
  if (!broadcastTimer) broadcastTimer = setTimeout(broadcast, 250);
}

function broadcast() {
  broadcastTimer = null;
  const snap = engine.snapshot();
  for (const win of [mainWindow, alertWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('state', snap);
  }
  updateTray();
  closeAlertWindowIfDone();
}

// ---------------------------------------------------------------------------
// IPC

ipcMain.handle('get-state', () => engine.snapshot());
ipcMain.handle('refresh', () => engine.refresh({ force: true }));
ipcMain.handle('acknowledge', (_e, ids) => engine.acknowledge(ids));
ipcMain.handle('set-read', (_e, ids, read) => engine.setRead(ids, read));
ipcMain.handle('open-external', (_e, url) => openExternal(url));
ipcMain.handle('open-config', () => openConfig());
ipcMain.handle('export-opml', () => exportOpml());
ipcMain.handle('reset-config', async () => {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Reset', 'Cancel'],
    message: 'Replace your sources & rules with the bundled defaults?',
    detail: 'Your current file is kept as config.json.bak.',
  });
  if (response === 0) {
    resetUserConfig(configPath);
    reloadConfig();
  }
});
ipcMain.handle('show-item', (_e, id) => showMain(id));

// ---------------------------------------------------------------------------
// Lifecycle

app.whenReady().then(() => {
  setFetch((url, opts) => net.fetch(url, opts));

  const dataDir = app.getPath('userData');
  configPath = path.join(dataDir, 'config.json');
  let config;
  try {
    config = loadUserConfig(configPath);
  } catch (err) {
    dialog.showErrorBox('IT Updates – config error', `${configPath}\n\n${err.message}\n\nUsing bundled defaults.`);
    config = require('../../config/default-config.json');
  }

  engine = new Engine({ dataDir, config });
  engine.on('updated', scheduleBroadcast);
  engine.on('alert', onAlert);
  engine.on('log', (m) => console.log(`[engine] ${m}`));

  let reloadTimer;
  fs.watchFile(configPath, { interval: 2000 }, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reloadConfig, 500);
  });

  tray = new Tray(trayIcon(false));
  tray.on('click', () => (engine.pendingAlerts().length ? showAlertWindow() : showMain()));
  updateTray();

  createMain();
  if (engine.pendingAlerts().length) showAlertWindow();

  engine.refresh();
  setInterval(() => {
    engine.refresh();
    nagIfPending();
  }, TICK_MS);
  powerMonitor.on('resume', () => setTimeout(() => engine.refresh(), 10e3));
  powerMonitor.on('unlock-screen', () => {
    if (engine.pendingAlerts().length) showAlertWindow();
  });
});

app.on('activate', () => showMain());
app.on('before-quit', () => {
  quitting = true;
  engine?.saveNow();
});
// Keep running in the tray when all windows are closed.
app.on('window-all-closed', () => {});
