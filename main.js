process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { app, Tray, Menu, Notification, shell, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
// Dynamic import helper for ESM-only node-fetch
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const configPath = path.join(__dirname, 'config.json');

// ─── Config I/O ────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('Failed to load config.json:', e);
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

// ─── Tray Icon Assets ──────────────────────────────────────────────────────────
// We map "yellow"→orange so anyAlarm uses the orange icon.
const iconPaths = {
  green:  path.join(__dirname, 'trayIcon-green.png'),
  yellow: path.join(__dirname, 'trayIcon-orange.png'),
  red:    path.join(__dirname, 'trayIcon-red.png')
};

// ─── State ─────────────────────────────────────────────────────────────────────
let tray;
let lastStatuses = {};
let settingsWindow;
let cfg = loadConfig();

// ─── Helpers ───────────────────────────────────────────────────────────────────
// Swap the tray icon image based on statusKey: 'green'|'yellow'|'red'
function updateTrayIcon(statusKey) {
  const img = nativeImage.createFromPath(iconPaths[statusKey] || iconPaths.red);
  tray.setImage(img);
}

function showNotification(site) {
  const icon = site.status === 'red' ? '🚨' : '⚠️';
  const body = site.status === 'red' ? 'Offline' : 'Partial Connectivity';
  new Notification({ title: `${icon} ${site.name}`, body, silent: false }).show();
}

// ─── Polling Loop ──────────────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const res = await fetch(cfg.statusUrl);
    const sites = await res.json();

    // Notify on changes
    sites.forEach(site => {
      const prev = lastStatuses[site.name];
      if (prev && prev !== site.status && (site.status === 'red' || site.status === 'yellow')) {
        showNotification(site);
      }
      lastStatuses[site.name] = site.status;
    });

    // Update tray icon: orange if any alarm, green otherwise
    const anyAlarm = sites.some(s => s.status === 'red' || s.status === 'yellow');
    updateTrayIcon(anyAlarm ? 'yellow' : 'green');
    return sites;
  } catch (err) {
    console.error('Error polling /status:', err);
    updateTrayIcon('red');
    throw err;
  }
}

// ─── Settings Window ───────────────────────────────────────────────────────────
function openSettings() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width:  360,
    height: 260,
    resizable: false,
    title: 'Settings',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false
    }
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => settingsWindow = null);
}

// ─── Tray Creation & Click Handling ────────────────────────────────────────────
function createTray() {
  // Start with green (no alarms yet)
  tray = new Tray(iconPaths.green);
  tray.setToolTip('Network Map Monitor');

  // Right-click menu
  const rightMenu = Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Open Map in Browser', click: () => shell.openExternal(cfg.openUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(rightMenu);

  // Left-click: fetch live status, update icon, show alerts + Solarwinds
  tray.on('click', async () => {
    let sites;
    try {
      // 1) Fetch /status
      const res = await fetch(cfg.statusUrl);
      sites = await res.json();
      // 2) Update icon: orange if any alarm
      const anyAlarm = sites.some(s => s.status === 'red' || s.status === 'yellow');
      updateTrayIcon(anyAlarm ? 'yellow' : 'green');
    } catch (err) {
      console.error('Error fetching /status:', err);
      updateTrayIcon('red');
      return tray.popUpContextMenu(Menu.buildFromTemplate([
        { label: 'Connection lost', enabled: false },
        { label: 'Quit', click: () => app.quit() }
      ]));
    }

    // 3) Build alert entries with emojis
    const alertItems = sites
      .filter(s => s.status === 'red' || s.status === 'yellow')
      .map(s => ({
        label: `${s.status === 'red' ? '🔴' : '🟡'} ${s.name}`,
        click: () => shell.openExternal(cfg.openUrl)
      }));
    if (!alertItems.length) {
      alertItems.push({ label: 'No current alerts', enabled: false });
    }

    // 4) Fetch /solarwinds-status
    let swConnected = false;
    try {
      const swUrl = cfg.statusUrl.replace(/\/status$/, '/solarwinds-status');
      const swRes = await fetch(swUrl);
      const swJson = await swRes.json();
      swConnected = !!swJson.connected;
    } catch (err) {
      console.error('Error fetching /solarwinds-status:', err);
    }
    const swItem = {
      label: swConnected
        ? '🟢 Solarwinds: Connected'
        : '🔴 Solarwinds: Disconnected',
      enabled: false
    };

    // 5) Assemble & show popup menu
    const template = [
      ...alertItems,
      { type: 'separator' },
      swItem,
      { label: 'Open Map in Browser', click: () => shell.openExternal(cfg.openUrl) },
      { label: 'Quit', click: () => app.quit() }
    ];
    tray.popUpContextMenu(Menu.buildFromTemplate(template));
  });
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('load-config', () => {
  cfg = loadConfig();
  return cfg;
});

ipcMain.on('save-config', (_evt, { host, port }) => {
  cfg.openUrl   = `https://${host}:${port}/`;
  cfg.statusUrl = `https://${host}:${port}/status`;
  saveConfig(cfg);

  // Refresh right-click menu
  const rightMenu = Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Open Map in Browser', click: () => shell.openExternal(cfg.openUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(rightMenu);

  // Immediately re-poll so icon matches new host
  pollStatus().catch(() => {});
});

// ─── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();
  pollStatus().catch(() => {});
  setInterval(() => pollStatus().catch(() => {}), cfg.pollIntervalMs);
});

app.on('window-all-closed', e => {
  // Prevent quitting so tray stays alive
  e.preventDefault();
});
