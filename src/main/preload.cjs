const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: connection => ipcRenderer.invoke('save-config', connection)
});