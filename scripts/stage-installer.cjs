const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

const root = path.join(__dirname, '..');
const destination = path.join(root, 'dist', 'installer');
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(
  path.join(root, 'dist', 'release', `Network-Map-Tray-Setup-${version}.exe`),
  path.join(destination, 'Network-Map-Tray-Setup.exe')
);