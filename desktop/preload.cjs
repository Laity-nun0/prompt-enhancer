const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  onDraft(callback) {
    const listener = (_event, text) => callback(text);
    ipcRenderer.on('companion:draft', listener);
    return () => ipcRenderer.removeListener('companion:draft', listener);
  },
  chooseProjectFolder: () => ipcRenderer.invoke('companion:choose-project-folder'),
  ready: () => ipcRenderer.invoke('companion:ready'),
  copyResult: token => ipcRenderer.invoke('companion:copy-result', token),
});
