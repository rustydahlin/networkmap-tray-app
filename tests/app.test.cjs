const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { test } = require('node:test');
const { unreleasedSection, inferBump, prepareChangelog, releaseNotes, verifyRelease } = require('../scripts/release.cjs');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const defaults = JSON.stringify({ statusUrl: 'https://localhost/status', openUrl: 'https://localhost/', pollIntervalMs: 10000 });

function boot({ packaged = true, installed = true, saved, locked = true, local, livePoll = false } = {}) {
  const files = new Map([['/bundle/src/config/default.json', defaults]]);
  if (saved) files.set('/user/config.json', JSON.stringify(saved));
  if (local) files.set('/bundle/src/config/local.json', JSON.stringify(local));
  const handlers = {};
  const ipc = {};
  const intervals = [];
  const timeouts = [];
  const login = [];
  const notices = [];
  const images = [];
  const windows = [];
  const state = { checks: 0, installs: 0, quits: 0, menu: [] };
  let ready;
  const logger = { info() {}, error() {}, warn() {}, debug() {} };
  const updater = {
    on: (event, callback) => { handlers[event] = callback; },
    checkForUpdates: async () => { state.checks++; },
    quitAndInstall: (silent, restart) => {
      assert.equal(silent, true);
      assert.equal(restart, true);
      state.installs++;
    }
  };
  const modules = {
    electron: {
      app: {
        isPackaged: packaged, getPath: () => '/user', requestSingleInstanceLock: () => locked,
        quit: () => { state.quits++; }, whenReady: () => ({ then: callback => { ready = callback; } }),
        setAppUserModelId() {}, getVersion: () => '1.1.0', setLoginItemSettings: options => login.push(options.openAtLogin), on() {}
      },
      Tray: class {
        constructor(image) { images.push(image); }
        setToolTip(value) { state.tooltip = value; }
        setImage() {}
        setContextMenu(value) { state.menu = value; }
        on() {}
      },
      Menu: { buildFromTemplate: value => value },
      Notification: class { constructor(options) { notices.push(options); } show() {} },
      shell: {},
      BrowserWindow: class {
        constructor(options) {
          state.windowOptions = options;
          state.settingsWindow = this;
          this.webContents = { setWindowOpenHandler() {}, on() {} };
        }
        setMenu(value) { state.windowMenu = value; }
        loadFile(file) { windows.push(file); }
        on() {}
      },
      ipcMain: { handle: (name, callback) => { ipc[name] = callback; }, on: (name, callback) => { ipc[name] = callback; } },
      nativeImage: { createFromPath: value => value }
    },
    'sound-play': { play: async () => {} }, path: path.posix, https: require('node:https'),
    'electron-updater': { autoUpdater: updater },
    winston: {
      createLogger: () => logger,
      format: { combine() {}, timestamp() {}, printf() {} },
      transports: { File: class {}, Console: class {} }
    },
    fs: {
      existsSync: name => name === '/resources/app-update.yml' ? installed : files.has(name),
      mkdirSync() {}, copyFileSync: (from, to) => files.set(to, files.get(from)),
      readFileSync: name => { assert.ok(files.has(name), name); return files.get(name); },
      writeFileSync: (name, value) => files.set(name, value)
    }
  };
  const context = vm.createContext({
    require: name => { assert.ok(name in modules, name); return modules[name]; },
    __dirname: '/bundle/src/main', process: { platform: 'win32', resourcesPath: '/resources', env: {} },
    console: { log() {}, error() {} }, URL,
    setInterval: (callback, delay) => intervals.push({ callback, delay }),
    setTimeout: (callback, delay) => timeouts.push({ callback, delay }), clearTimeout() {}
  });
  if (livePoll) {
    // Serve /status from context.__sites so the real pollStatus() runs.
    context.__sites = [];
    vm.runInContext(source.replace('const fetch = (url', 'let fetch = (url') +
      '\nfetch = async () => ({ json: async () => __sites }); pollSolarwindsStatus = async () => {};', context);
  } else {
    vm.runInContext(source + '\npollStatus = async () => []; pollSolarwindsStatus = async () => {};', context);
  }
  ready();
  return { files, handlers, ipc, intervals, timeouts, login, notices, images, windows, state, updater, context };
}

test('installed app seeds settings and enables login startup and update checks', () => {
  const app = boot();
  assert.equal(app.files.get('/user/config.json'), defaults);
  assert.deepEqual(app.login, [true]);
  assert.equal(app.state.checks, 1);
  assert.ok(app.intervals.some(item => item.delay === 21600000));
  assert.equal(app.updater.autoDownload, true);
  assert.equal(app.updater.autoInstallOnAppQuit, false);
  assert.equal(app.context.process.env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
});

test('saved settings survive upgrades and startup opt-out survives settings changes', () => {
  const saved = { ...JSON.parse(defaults), openUrl: 'https://existing/', startAtLogin: false };
  const app = boot({ saved });
  assert.deepEqual(JSON.parse(app.files.get('/user/config.json')), saved);
  assert.deepEqual(app.login, [false]);
  app.state.menu.find(item => item.label === 'Start with Windows').click({ checked: false });
  app.state.menu.find(item => item.label.startsWith('Settings')).click();
  app.ipc['save-config']({ sender: app.state.settingsWindow.webContents }, { host: 'new-host', port: 3000 });
  assert.equal(JSON.parse(app.files.get('/user/config.json')).startAtLogin, false);
  assert.equal(JSON.parse(app.files.get('/user/config.json')).openUrl, 'https://new-host:3000/');
  assert.ok(app.state.menu.find(item => item.label === 'Start with Windows'));
});

test('raw and development builds do not enable updates or login startup', () => {
  for (const options of [{ installed: false }, { packaged: false, installed: false }]) {
    const app = boot(options);
    assert.equal(app.state.checks, 0);
    assert.deepEqual(app.login, []);
  }
  const local = { ...JSON.parse(defaults), openUrl: 'https://local-development/' };
  const app = boot({ packaged: false, installed: false, local });
  assert.deepEqual(JSON.parse(app.files.get('/bundle/src/config/local.json')), local);
});

test('a second instance exits without starting monitoring or updates', () => {
  const app = boot({ locked: false });
  assert.equal(app.state.quits, 1);
  assert.equal(app.state.checks, 0);
  assert.deepEqual(app.login, []);
  assert.deepEqual(app.images, []);
});

test('downloaded update notifies and restarts silently after five seconds', () => {
  const app = boot();
  app.handlers.error(new Error('offline'));
  app.handlers['update-downloaded']();
  assert.ok(app.notices.some(item => item.title.includes('update ready')));
  assert.equal(app.timeouts.at(-1).delay, 5000);
  app.timeouts.at(-1).callback();
  assert.equal(app.state.installs, 1);
});

test('settings use an isolated preload and enough content space without a menu bar', () => {
  const app = boot();
  app.state.menu.find(item => item.label.startsWith('Settings')).click();
  assert.equal(app.state.windowOptions.useContentSize, true);
  assert.equal(app.state.windowOptions.height, 350);
  assert.equal(app.state.windowMenu, null);
  assert.equal(app.state.windowOptions.webPreferences.nodeIntegration, false);
  assert.equal(app.state.windowOptions.webPreferences.contextIsolation, true);
  assert.equal(app.state.windowOptions.webPreferences.sandbox, true);
  assert.equal(app.state.windowOptions.webPreferences.preload, '/bundle/src/main/preload.cjs');
});

test('settings preserve HTTP and reject invalid connections or untrusted IPC senders', () => {
  const app = boot();
  assert.throws(() => app.ipc['load-config']({ sender: {} }), /settings window/);
  app.state.menu.find(item => item.label.startsWith('Settings')).click();
  const event = { sender: app.state.settingsWindow.webContents };
  app.ipc['save-config'](event, { protocol: 'http', host: 'localhost', port: 80 });
  assert.equal(JSON.parse(app.files.get('/user/config.json')).openUrl, 'http://localhost/');
  for (const connection of [
    { protocol: 'file', host: 'localhost', port: 80 },
    { protocol: 'https', host: 'localhost/path', port: 443 },
    { protocol: 'https', host: 'localhost', port: 0 },
    { protocol: 'https', host: 'localhost', port: 65536 }
  ]) assert.throws(() => app.ipc['save-config'](event, connection), /valid host/);
});

test('manual update check reports up-to-date and is disabled in raw builds', async () => {
  const app = boot();
  await new Promise(setImmediate);
  const check = app.state.menu.find(item => item.label === 'Check for Updates');
  assert.equal(check.enabled, true);
  const result = check.click();
  assert.equal(app.state.checks, 2);
  assert.ok(app.state.menu.some(item => item.label === 'Checking for Updates...' && !item.enabled));
  app.handlers['update-not-available']();
  await result;
  assert.ok(app.notices.some(item => item.title.includes('up to date')));
  const raw = boot({ installed: false });
  assert.equal(raw.state.menu.find(item => item.label === 'Check for Updates').enabled, false);
});

test('manual update download and failure give feedback without duplicate checks', async () => {
  const app = boot();
  await new Promise(setImmediate);
  await app.state.menu.find(item => item.label === 'Check for Updates').click();
  app.handlers['update-available']();
  assert.ok(app.notices.some(item => item.title.includes('Downloading')));
  assert.ok(app.state.menu.some(item => item.label === 'Downloading Update...' && !item.enabled));
  app.handlers.error(new Error('offline'));
  assert.ok(app.notices.some(item => item.title.includes('Unable')));
  assert.ok(app.state.menu.some(item => item.label === 'Check for Updates' && item.enabled));
});

test('muted sites and devices stay silent, and a site still alarming when its mute ends alerts once', async () => {
  const app = boot({ livePoll: true });
  const poll = async sites => { app.context.__sites = sites; await app.context.pollStatus(); };
  const alerts = () => app.notices.filter(item => /^(🚨|⚠️) /u.test(item.title)).map(item => item.title);
  const site = (name, status, extra = {}) => ({ name, status, alertStatus: status, muted: false, details: [], ...extra });
  await new Promise(setImmediate);
  // End the post-reconnect suppression window.
  app.timeouts.filter(item => item.delay === 180000).forEach(item => item.callback());

  await poll([site('A', 'green'), site('B', 'green'), site('C', 'green')]);
  assert.equal(alerts().length, 0);

  // Site A muted and goes red: silent. B's only down device is muted (yellow, alertStatus green): silent.
  await poll([site('A', 'red', { muted: true, mute: { until: '2099-01-01T00:00:00Z' } }),
    site('B', 'yellow', { alertStatus: 'green' }), site('C', 'green')]);
  assert.equal(alerts().length, 0);

  // Unmuted sites still alert normally.
  await poll([site('A', 'red', { muted: true }), site('B', 'yellow', { alertStatus: 'green' }), site('C', 'red')]);
  assert.deepEqual(alerts(), ['🚨 C']);

  // A's mute ends while still red: one catch-up alert, then quiet.
  await poll([site('A', 'red'), site('B', 'yellow', { alertStatus: 'green' }), site('C', 'red')]);
  assert.deepEqual(alerts(), ['🚨 C', '🚨 A']);
  await poll([site('A', 'red'), site('B', 'yellow', { alertStatus: 'green' }), site('C', 'red')]);
  assert.equal(alerts().length, 2);

  // Whole-map mute shows in the tooltip and silences everything.
  const globalMute = { scope: 'global', until: '2099-01-01T00:00:00Z' };
  await poll([site('A', 'green', { muted: true, globalMute }), site('B', 'red', { muted: true, globalMute }),
    site('C', 'red', { muted: true, globalMute })]);
  assert.equal(alerts().length, 2);
  assert.match(app.state.tooltip, /muted until/);
  assert.doesNotMatch(app.state.tooltip, /turned off/);

  // An open-ended ("Until I turn it off") mute says so instead of showing the sentinel date.
  const openEnded = { scope: 'global', until: '9999-12-31T00:00:00.000Z', indefinite: true };
  await poll([site('A', 'red', { muted: true, globalMute: openEnded })]);
  assert.equal(alerts().length, 2);
  assert.match(app.state.tooltip, /muted until turned off/);
  assert.doesNotMatch(app.state.tooltip, /9999/);
});

test('runtime resources resolve within the reorganized src directory', () => {
  const app = boot();
  assert.ok(require('../package.json').scripts['package:raw'].includes('--no-asar'));
  assert.equal(app.images[0], '/bundle/src/assets/icons/trayIcon-green.png');
  app.state.menu.find(item => item.label.startsWith('Settings')).click();
  assert.equal(app.windows[0], '/bundle/src/renderer/settings.html');
  for (const file of ['config/default.json', 'renderer/settings.html', 'assets/icons/trayIcon-green.png', 'assets/icons/trayIcon-orange.png', 'assets/icons/trayIcon-red.png', 'assets/sounds/alert.wav', 'assets/sounds/server-back.wav', 'assets/sounds/server-down.wav']) {
    assert.ok(fs.existsSync(path.join(root, 'src', file)), file);
  }
  assert.equal(new URL(require('../src/config/default.json').openUrl).hostname, '127.0.0.1');
});

const changelog = '# Changelog\n\n## [Unreleased]\n\n### Added\n- Added installer publishing.\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- Initial app.\n';

test('release preparation infers semver and preserves an empty Unreleased section', () => {
  assert.equal(inferBump(unreleasedSection(changelog).body), 'minor');
  assert.equal(inferBump('### Fixed\n- A fix.'), 'patch');
  assert.equal(inferBump('### Added\n- Feature.', 'feat!: removed API'), 'major');
  assert.equal(inferBump('### Removed\n- Supported API.'), 'major');
  const prepared = prepareChangelog(changelog, '1.1.0', '2026-11-05');
  assert.equal(unreleasedSection(prepared).body, '');
  assert.match(prepared, /## \[1\.1\.0\] - 2026-11-05/);
  assert.match(prepared, /## \[1\.0\.0\]/);
  assert.equal(releaseNotes(prepared, '1.1.0'), '### Added\n- Added installer publishing.\n');
  assert.throws(() => prepareChangelog(prepared, '1.2.0', '2026-11-05'), /no changes/);
  assert.throws(() => prepareChangelog(changelog, '1.0.0', '2026-11-05'), /already exists/);
  const firstRelease = prepareChangelog(changelog.slice(0, changelog.indexOf('## [1.0.0]')), '1.1.0', '2026-11-05');
  assert.ok(firstRelease.endsWith('Added installer publishing.\n'));
});

test('release verification rejects tag, lockfile, and changelog mismatches', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'networkmap-release-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (file, value) => fs.writeFileSync(path.join(directory, file), typeof value === 'string' ? value : JSON.stringify(value));
  write('package.json', { version: '1.1.0' });
  write('package-lock.json', { version: '1.1.0', packages: { '': { version: '1.1.0' } } });
  write('CHANGELOG.md', prepareChangelog(changelog, '1.1.0', '2026-11-05'));
  assert.equal(verifyRelease(directory, 'v1.1.0'), '1.1.0');
  assert.throws(() => verifyRelease(directory, 'v1.0.0'), /tag/);
  write('package-lock.json', { version: '1.0.0' });
  assert.throws(() => verifyRelease(directory, 'v1.1.0'), /versions must match/);
  write('package-lock.json', { version: '1.1.0', packages: { '': { version: '1.1.0' } } });
  write('CHANGELOG.md', changelog);
  assert.throws(() => verifyRelease(directory, 'v1.1.0'), /Unreleased entries/);
});