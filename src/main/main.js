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
const sound = require('sound-play');
const path = require('path');
const https = require('https');
const { autoUpdater } = require('electron-updater');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const winston = require('winston');
const log = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: path.join(app.getPath('userData'), 'tray-app.log') }),
    new winston.transports.Console()
  ]
});

const originalConsole = {
  log: console.log,
  error: console.error
};

function logInfo(msg) {
  originalConsole.log(msg);
  log.info(msg);
}

function logError(msg) {
  originalConsole.error(msg);
  log.error(msg);
}
const fs = require('fs');
const isInstalledBuild = app.isPackaged &&
  fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));

// ESM-only node-fetch helper
const monitoringAgent = new https.Agent({ rejectUnauthorized: false });
const fetch = (url, options = {}) =>
  import('node-fetch').then(({ default: fetch }) => fetch(url, {
    ...options,
    agent: new URL(url).protocol === 'https:' ? monitoringAgent : undefined
  }));

const sourcePath = path.join(__dirname, '..');
const bundledConfigPath = path.join(sourcePath, 'config', 'default.json');
const localConfigPath = path.join(sourcePath, 'config', 'local.json');
const configPath = app.isPackaged
  ? path.join(app.getPath('userData'), 'config.json')
  : localConfigPath;

// ─── Config I/O ────────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (!fs.existsSync(configPath)) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.copyFileSync(bundledConfigPath, configPath);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    logError('Failed to load config.json:', e);
    return {};
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

// ─── Tray Icon Assets ──────────────────────────────────────────────────────────
// Note: yellow→orange so user sees orange for alarms
const iconPaths = {
  green: path.join(sourcePath, 'assets', 'icons', 'trayIcon-green.png'),
  yellow: path.join(sourcePath, 'assets', 'icons', 'trayIcon-orange.png'),
  red: path.join(sourcePath, 'assets', 'icons', 'trayIcon-red.png')
};

// ─── State ─────────────────────────────────────────────────────────────────────
let tray;
let lastStatuses = {};
let lastSwConnected = null;
let lastServerConnected = null;            // ↕️ SERVER CONNECTION ADDED ↕️
let reconnectTime = null;
let suppressNotifications = false;
let notificationSuppressionTimer;
let settingsWindow;
let cfg = loadConfig();

const NOTIFICATION_SUPPRESSION_MS = 3 * 60 * 1000;
const ALERT_BURST_THRESHOLD = 3;

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

  // 1) Mute the toast’s built-in ding
  new Notification({ title: `${icon} ${site.name}`, body, silent: true }).show();

  // 2) Play your custom alert
  sound.play(path.join(sourcePath, 'assets', 'sounds', 'alert.wav'))
    .catch(err => logError('Sound play failed:', err));
}

function showAlertSummary(count) {
  new Notification({
    title: 'Multiple sites reporting issues',
    body: `${count} sites changed to an alert state. Individual alerts are paused for 3 minutes.`,
    silent: true
  }).show();

  sound.play(path.join(sourcePath, 'assets', 'sounds', 'alert.wav'))
    .catch(err => logError('Sound play failed:', err));
}

function suppressSiteNotifications() {
  suppressNotifications = true;
  clearTimeout(notificationSuppressionTimer);
  notificationSuppressionTimer = setTimeout(() => {
    suppressNotifications = false;
    notificationSuppressionTimer = null;
    logInfo('Notification suppression ended.');
  }, NOTIFICATION_SUPPRESSION_MS);
}

// Poll /status, raise notifications, update tray icon
async function pollStatus() {
  try {
    const res = await fetch(cfg.statusUrl);
    const sites = await res.json();

    // ↕️ SERVER CONNECTION NOTIFICATIONS ↕️
    // If we've polled once before and we were disconnected, now we're back
    if (lastServerConnected === false) {
      new Notification({
        title: '🟢 Server Re-connected',
        body: 'Connection to server restored.',
        silent: true
    }).show();

    sound.play(path.join(sourcePath, 'assets', 'sounds', 'server-back.wav'));
  }

    lastServerConnected = true;

    // Server is back online
    if (reconnectTime === null) {
      reconnectTime = Date.now();
      suppressSiteNotifications();
    }

    const alertTransitions = sites.filter(site => {
      const prev = lastStatuses[site.name];
      return (
        prev &&
        prev !== site.status &&
        (site.status === 'red' || site.status === 'yellow')
      );
    });
    const activeAlertCount = sites.filter(
      site => site.status === 'red' || site.status === 'yellow'
    ).length;

    if (!suppressNotifications) {
      if (
        alertTransitions.length >= ALERT_BURST_THRESHOLD ||
        (alertTransitions.length > 0 && activeAlertCount >= ALERT_BURST_THRESHOLD)
      ) {
        showAlertSummary(activeAlertCount);
        suppressSiteNotifications();
      } else {
        alertTransitions.forEach(showNotification);
      }
    }

    sites.forEach(site => {
      lastStatuses[site.name] = site.status;
    });

    const anyAlarm = sites.some(s => s.status === 'red' || s.status === 'yellow');
    updateTrayIcon(anyAlarm ? 'yellow' : 'green');
    return sites;
  } catch (err) {
    logError('Error polling /status:', err);

    // ↕️ SERVER CONNECTION LOST NOTIFICATION ↕️
    
if (lastServerConnected === true || lastServerConnected === null) {
  new Notification({
    title: '🔴 Server Disconnected',
    body: 'Lost connection to server.',
    silent: true
  }).show();

  sound.play(path.join(sourcePath, 'assets', 'sounds', 'server-down.wav'));
}

    lastServerConnected = false;

    updateTrayIcon('red');

    // Clear reconnect timestamp so we trigger delay next time it comes back
    reconnectTime = null;
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
    logError('SolarWinds poll failed:', e);
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
  settingsWindow.loadFile(path.join(sourcePath, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => (settingsWindow = null));
}

// ─── Tray Creation & Click Handling ────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    {
      label: 'Open Map in Browser',
      click: () => shell.openExternal(cfg.openUrl)
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      visible: isInstalledBuild && process.platform === 'win32',
      checked: cfg.startAtLogin !== false,
      click: item => {
        cfg.startAtLogin = item.checked;
        saveConfig(cfg);
        app.setLoginItemSettings({ openAtLogin: item.checked });
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

function createTray() {
  // Start neutral (green)
  tray = new Tray(iconPaths.green);
  tray.setToolTip('Network Map Monitor');

  // Right-click menu stays the same
  tray.setContextMenu(buildTrayMenu());

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
      logError('Error fetching /status:', err);
      updateTrayIcon('red');
      return tray.popUpContextMenu(
        Menu.buildFromTemplate([
          { label: '🔴 Server: Disconnected', enabled: false },     // ↕️ SERVER STATUS IN MENU ↕️
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
          focusUrl = `${cfg.openUrl}?lat=${site.lat}&lng=${site.lng}&zoom=10&popup=${encodeURIComponent(
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

    // 3) SERVER STATUS MENU ITEM
    const serverItem = {
      label: lastServerConnected
        ? '🟢 Server: Connected'
        : '🔴 Server: Disconnected',
      enabled: false
    };

    // 4) fetch /solarwinds-status for actual Solarwinds connection
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
      logError('Error fetching /solarwinds-status:', err);
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
      serverItem,   // ↕️ INSERTED HERE ↕️
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
  tray.setContextMenu(buildTrayMenu());

  // immediately refresh icon state
  pollStatus().catch(() => {});
});

// ─── App Lifecycle ─────────────────────────────────────────────────────────────
function startAutomaticUpdates() {
  if (!isInstalledBuild || process.platform !== 'win32') return;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', error => logError(`Update failed: ${error.message}`));
  autoUpdater.on('update-downloaded', () => {
    new Notification({
      title: 'Network Map Tray update ready',
      body: 'Restarting in 5 seconds to install the update.',
      silent: true
    }).show();
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 5000);
  });

  const checkForUpdates = () => {
    autoUpdater.checkForUpdates().catch(error => {
      logError(`Update check failed: ${error.message}`);
    });
  };
  checkForUpdates();
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  app.setAppUserModelId('com.rustydahlin.networkmaptray');
  if (isInstalledBuild && process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: cfg.startAtLogin !== false });
  }
  createTray();
  startAutomaticUpdates();
  pollStatus().catch(() => {});
  pollSolarwindsStatus(); 
  setInterval(pollStatus, cfg.pollIntervalMs);
  setInterval(pollSolarwindsStatus, cfg.pollIntervalMs);
});

app.on('window-all-closed', e => {
  // keep tray alive
  e.preventDefault();
});
