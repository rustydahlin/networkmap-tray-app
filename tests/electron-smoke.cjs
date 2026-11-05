const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { once } = require('node:events');
const { app, BrowserWindow, nativeTheme } = require('electron');

const root = path.join(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'networkmap-electron-'));
fs.mkdirSync(path.join(temporary, 'user-data'));
app.setPath('userData', path.join(temporary, 'user-data'));
app.disableHardwareAcceleration();
const timeout = setTimeout(() => {
  console.error('Electron smoke test timed out.');
  app.exit(1);
}, 30000);

async function checkLayout(window) {
  const layout = await window.webContents.executeJavaScript(`({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    saveBottom: document.getElementById('save').getBoundingClientRect().bottom,
    iconLoaded: document.querySelector('header img').naturalWidth > 0
  })`);
  assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
  assert.ok(layout.scrollHeight <= layout.height, JSON.stringify(layout));
  assert.ok(layout.saveBottom <= layout.height, JSON.stringify(layout));
  assert.equal(layout.iconLoaded, true);
}

async function main() {
  assert.equal(process.versions.electron, require('../package.json').devDependencies.electron);
  fs.cpSync(path.join(root, 'src'), path.join(temporary, 'src'), {
    recursive: true,
    filter: source => path.basename(source) !== 'local.json'
  });
  const filename = path.join(temporary, 'src', 'main', 'main.js');
  const application = new Module(filename, module);
  application.filename = filename;
  application.paths = Module._nodeModulePaths(root);
  application._compile(fs.readFileSync(filename, 'utf8') +
    '\npollStatus = async () => []; pollSolarwindsStatus = async () => {}; module.exports = { openSettings };', filename);

  await app.whenReady();
  application.exports.openSettings();
  const window = BrowserWindow.getAllWindows()[0];
  await once(window.webContents, 'did-finish-load');
  await window.webContents.executeJavaScript('window.settings.loadConfig()');
  const security = await window.webContents.executeJavaScript(`({
    requireType: typeof require, processType: typeof process,
    host: document.getElementById('host').value,
    port: document.getElementById('port').value,
    saveEnabled: !document.getElementById('save').disabled
  })`);
  assert.equal(security.requireType, 'undefined');
  assert.equal(security.processType, 'undefined');
  assert.equal(security.host, '127.0.0.1');
  assert.equal(security.port, '3000');
  assert.equal(security.saveEnabled, true);
  assert.equal(window.isMenuBarVisible(), false);

  const output = path.join(root, 'dist');
  fs.mkdirSync(output, { recursive: true });
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    for (const width of [420, 360]) {
      window.setContentSize(width, 350);
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await checkLayout(window);
    }
    window.setContentSize(420, 350);
    const screenshot = await window.webContents.capturePage();
    assert.equal(screenshot.isEmpty(), false);
    fs.writeFileSync(path.join(output, `settings-${theme}.png`), screenshot.toPNG());
  }

  await window.webContents.executeJavaScript("document.getElementById('host').focus()");
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  assert.equal(await window.webContents.executeJavaScript('document.activeElement.id'), 'protocol');

  await window.webContents.executeJavaScript(`new Promise(resolve => {
    const error = document.getElementById('error');
    const observer = new MutationObserver(() => {
      if (error.textContent) { observer.disconnect(); resolve(); }
    });
    observer.observe(error, { childList: true });
    document.getElementById('host').value = 'localhost/path';
    document.getElementById('settings-form').requestSubmit();
  })`);
  await checkLayout(window);
  const closed = once(window, 'closed');
  await window.webContents.executeJavaScript(`
    document.getElementById('host').value = 'localhost';
    document.getElementById('protocol').value = 'http';
    document.getElementById('port').value = '8080';
    document.getElementById('settings-form').requestSubmit();
  `);
  await closed;
  const saved = JSON.parse(fs.readFileSync(path.join(temporary, 'src', 'config', 'local.json'), 'utf8'));
  assert.equal(saved.openUrl, 'http://localhost:8080/');
  assert.equal(saved.statusUrl, 'http://localhost:8080/status');
  console.log(`PASS: Electron ${process.versions.electron} startup, isolated settings bridge, light/dark layouts at both widths, no scrolling, keyboard focus, validation, and HTTP form save.`);
}

main().then(() => {
  clearTimeout(timeout);
  app.exit(0);
}).catch(error => {
  clearTimeout(timeout);
  console.error(error);
  app.exit(1);
});