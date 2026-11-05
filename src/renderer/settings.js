const form = document.getElementById('settings-form');
const host = document.getElementById('host');
const port = document.getElementById('port');
const protocol = document.getElementById('protocol');
const save = document.getElementById('save');
const error = document.getElementById('error');

async function loadSettings() {
  try {
    const config = await window.settings.loadConfig();
    const url = new URL(config.openUrl);
    protocol.value = url.protocol.replace(':', '');
    host.value = url.hostname;
    port.value = url.port || (url.protocol === 'https:' ? '443' : '80');
    save.disabled = false;
    host.focus();
  } catch {
    error.textContent = 'Could not load settings. Close this window and try again.';
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  save.disabled = true;
  try {
    await window.settings.saveConfig({ protocol: protocol.value, host: host.value.trim(), port: port.value });
    window.close();
  } catch {
    error.textContent = 'Could not save settings. Check the host and port.';
    save.disabled = false;
  }
});

document.getElementById('cancel').addEventListener('click', () => window.close());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.close();
});

loadSettings();