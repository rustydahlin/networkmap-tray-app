process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { app, Tray, Menu, Notification, shell, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Force ipv4 Using DNS
//const dns = require('dns');
//if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');

// Dynamic import helper for ESM-only node-fetch, Require HTTPS
const https = require('https');
const fetch = (...args) => import('node-fetch')
  .then(({ default: fetch }) => fetch(...args, { agent: new https.Agent({ family: 4 }) }));

const configPath = path.join(__dirname, 'config.json');

// Helper to read + parse config.json
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('Failed to load config.json:', e);
    return {};
  }
}

// Helper to write updated config.json
function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

let tray;
let lastStatuses = {};
let settingsWindow;
let cfg = loadConfig();

// Show desktop notification for a site
function showNotification(site) {
  const level = site.status === 'red' ? 'Offline' : 'Partial Connectivity';
  const icon  = site.status === 'red' ? '🚨' : '⚠️';
  new Notification({
    title: `${icon} ${site.name}`,
    body: `Status: ${level}`,
    silent: false
  }).show();
}

// Poll the /status endpoint and notify on changes
async function pollStatus() {
  try {
    const res = await fetch(cfg.statusUrl);
    const sites = await res.json();
    sites.forEach(site => {
      const prev = lastStatuses[site.name];
      if (prev && prev !== site.status && (site.status === 'red' || site.status === 'yellow')) {
        showNotification(site);
      }
      lastStatuses[site.name] = site.status;
    });
  } catch (err) {
    console.error('Error polling status:', err);
  }
}

// Open the settings window
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

// Create the tray icon, context menus, and click handlers
function createTray() {
  tray = new Tray(path.join(__dirname, 'trayIcon.png'));

  // Right-click menu
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Open Map in Browser', click: () => shell.openExternal(cfg.openUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip('Network Map Monitor');

  // Left-click: show alerts menu
  tray.on('click', async () => {
    try {
      const res = await fetch(cfg.statusUrl);
      const sites = await res.json();
      const alerts = sites.filter(site => site.status === 'red' || site.status === 'yellow');
      let template;
      if (alerts.length === 0) {
        template = [
          { label: 'No current alerts', enabled: false },
          { type: 'separator' },
          { label: 'Open Map in Browser', click: () => shell.openExternal(cfg.openUrl) },
          { label: 'Quit', click: () => app.quit() }
        ];
      } else {
        template = alerts.map(site => ({
          label: `${site.name} (${site.status.toUpperCase()})`,
          click: () => shell.openExternal(cfg.openUrl)
        }));
        template.push({ type: 'separator' });
        template.push({ label: 'Open Map in Browser', click: () => shell.openExternal(cfg.openUrl) });
        template.push({ label: 'Quit', click: () => app.quit() });
      }
      const menu = Menu.buildFromTemplate(template);
      tray.popUpContextMenu(menu);
    } catch (err) {
      console.error('Error fetching alerts for tray:', err);
    }
  });
}

// IPC handlers for settings window
ipcMain.handle('load-config', () => {
  cfg = loadConfig();
  return cfg;
});

ipcMain.on('save-config', (_event, { host, port }) => {
  cfg.openUrl   = `https://${host}:${port}/`;
  cfg.statusUrl = `https://${host}:${port}/status`;
  saveConfig(cfg);

  // Refresh right-click menu
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Open Map in Browser', click: () => shell.openExternal(cfg.openUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);

  // Re-poll immediately with new URL
  pollStatus();
});

// App ready: create tray, start polling
app.whenReady().then(() => {
  createTray();
  pollStatus();
  setInterval(pollStatus, cfg.pollIntervalMs);
});

// Prevent the app from quitting when all windows are closed
app.on('window-all-closed', e => {
  e.preventDefault();
});
