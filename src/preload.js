'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  refresh: () => ipcRenderer.invoke('refresh'),
  acknowledge: (ids) => ipcRenderer.invoke('acknowledge', ids),
  setRead: (ids, read) => ipcRenderer.invoke('set-read', ids, read),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openConfig: () => ipcRenderer.invoke('open-config'),
  resetConfig: () => ipcRenderer.invoke('reset-config'),
  exportOpml: () => ipcRenderer.invoke('export-opml'),
  showItem: (id) => ipcRenderer.invoke('show-item', id),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onSelectItem: (cb) => ipcRenderer.on('select-item', (_e, id) => cb(id)),
  onShake: (cb) => ipcRenderer.on('shake', () => cb()),
});
