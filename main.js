process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const {
  app,
  Tray,
  Menu,
  Notification,
  shell,
  BrowserWindow,
  ipcMain,
  nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');

// ESM-only node-fetch helper
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

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
// Note: yellow→orange so user sees orange for alarms
const iconPaths = {
  green: path.join(__dirname, 'trayIcon-green.png'),
  yellow: path.join(__dirname, 'trayIcon-orange.png'),
  red: path.join(__dirname, 'trayIcon-red.png')
};

// ─── State ─────────────────────────────────────────────────────────────────────
let tray;
let lastStatuses = {};
let lastSwConnected = null;
let settingsWindow;
let cfg = loadConfig();

// ─── Helpers ───────────────────────────────────────────────────────────────────
// Swap the tray icon image based on 'green'|'yellow'|'red'
function updateTrayIcon(statusKey) {
  const img = nativeImage.createFromPath(
    iconPaths[statusKey] || iconPaths.red
  );
  tray.setImage(img);
}

// Desktop notification for a site status change
function showNotification(site) {
  const icon = site.status === 'red' ? '🚨' : '⚠️';
  const body = site.status === 'red' ? 'Offline' : 'Partial Connectivity';
  new Notification({ title: `${icon} ${site.name}`, body, silent: false }).show();
}

// Poll /status, raise notifications, update tray icon
async function pollStatus() {
  try {
    const res = await fetch(cfg.statusUrl);
    const sites = await res.json();

    // Notify only on transitions to yellow/red
    sites.forEach(site => {
      const prev = lastStatuses[site.name];
      if (
        prev &&
        prev !== site.status &&
        (site.status === 'red' || site.status === 'yellow')
      ) {
        showNotification(site);
      }
      lastStatuses[site.name] = site.status;
    });

    // If any site is red or yellow, use yellow (orange) icon; else green
    const anyAlarm = sites.some(
      s => s.status === 'red' || s.status === 'yellow'
    );
    updateTrayIcon(anyAlarm ? 'yellow' : 'green');
    return sites;
  } catch (err) {
    console.error('Error polling /status:', err);
    // network failure → red icon
    updateTrayIcon('red');
    throw err;
  }
}

async function pollSolarwindsStatus() {
  try {
    const swUrl   = cfg.statusUrl.replace(/\/status$/, '/solarwinds-status');
    const swRes   = await fetch(swUrl);
    const { connected } = await swRes.json();

    // if we've polled before and the status flipped...
    if (lastSwConnected !== null && connected !== lastSwConnected) {
      new Notification({
        title: connected
          ? '🟢 SolarWinds Re-connected'
          : '🔴 SolarWinds Disconnected',
        body: connected
          ? 'The SolarWinds API is back online.'
          : 'Lost connection to SolarWinds API.'
      }).show();
    }
    lastSwConnected = connected;

    // Optionally update your tray‐icon opacity/color here:
    // tray.setImage(nativeImage.createFromPath(
    //   connected ? iconPaths.green : iconPaths.red
    // ));
  } catch (e) {
    console.error('SolarWinds poll failed:', e);
  }
}

// ─── Settings Window ───────────────────────────────────────────────────────────
function openSettings() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 360,
    height: 260,
    resizable: false,
    title: 'Settings',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => (settingsWindow = null));
}

// ─── Tray Creation & Click Handling ────────────────────────────────────────────
function createTray() {
  // Start neutral (green)
  tray = new Tray(iconPaths.green);
  tray.setToolTip('Network Map Monitor');

  // Right-click menu stays the same
  const rightMenu = Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    {
      label: 'Open Map in Browser',
      click: () => shell.openExternal(cfg.openUrl)
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(rightMenu);

  // Left-click: fetch live status → build menu entries
  tray.on('click', async () => {
    let sites;
    try {
      // 1) get /status
      const res = await fetch(cfg.statusUrl);
      sites = await res.json();
      // update tray color
      const anyAlarm = sites.some(
        s => s.status === 'red' || s.status === 'yellow'
      );
      updateTrayIcon(anyAlarm ? 'yellow' : 'green');
    } catch (err) {
      console.error('Error fetching /status:', err);
      updateTrayIcon('red');
      return tray.popUpContextMenu(
        Menu.buildFromTemplate([
          { label: 'Connection lost', enabled: false },
          { label: 'Quit', click: () => app.quit() }
        ])
      );
    }

    // 2) build alert items with zoom+popup URLs
    const alertItems = sites
      .filter(s => s.status === 'red' || s.status === 'yellow')
      .map(site => {
        // choose emoji
        const emoji = site.status === 'red' ? '🔴' : '🟡';
        // if your /status payload includes lat/lng:
        let focusUrl;
        if (site.lat != null && site.lng != null) {
          focusUrl = `${cfg.openUrl}?lat=${site.lat}&lng=${site.lng}&zoom=15&popup=${encodeURIComponent(
            site.name
          )}`;
        } else {
          // fallback to anchor
          focusUrl = `${cfg.openUrl}#${encodeURIComponent(site.name)}`;
        }
        return {
          label: `${emoji} ${site.name}`,
          click: () => shell.openExternal(focusUrl)
        };
      });

    if (!alertItems.length) {
      alertItems.push({ label: 'No current alerts', enabled: false });
    }

    // 3) fetch /solarwinds-status for actual Solarwinds connection
    let swConnected = false;
    try {
      const swUrl = cfg.statusUrl.replace(
        /\/status$/,
        '/solarwinds-status'
      );
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

    // 4) assemble full menu
    const menuTpl = [
      ...alertItems,
      { type: 'separator' },
      swItem,
      {
        label: 'Open Map in Browser',
        click: () => shell.openExternal(cfg.openUrl)
      },
      { label: 'Quit', click: () => app.quit() }
    ];
    tray.popUpContextMenu(Menu.buildFromTemplate(menuTpl));
  });
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('load-config', () => {
  cfg = loadConfig();
  return cfg;
});

ipcMain.on('save-config', (_evt, { host, port }) => {
  cfg.openUrl = `https://${host}:${port}/`;
  cfg.statusUrl = `https://${host}:${port}/status`;
  saveConfig(cfg);

  // refresh right‐click menu
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Settings…', click: openSettings },
      {
        label: 'Open Map in Browser',
        click: () => shell.openExternal(cfg.openUrl)
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  );

  // immediately refresh icon state
  pollStatus().catch(() => {});
});

// ─── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();
  pollStatus().catch(() => {});
  pollSolarwindsStatus(); 
  setInterval(pollStatus, cfg.pollIntervalMs);
  setInterval(pollSolarwindsStatus, cfg.pollIntervalMs);
});

app.on('window-all-closed', e => {
  // keep tray alive
  e.preventDefault();
});
