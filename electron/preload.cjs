const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  app: 'DevSecOps Pipeline',
  appInfo: {
    get: () => ipcRenderer.invoke('app:get-info'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => {
      if (typeof callback !== 'function') {
        return () => {}
      }

      const listener = (_event, value) => callback(Boolean(value))
      ipcRenderer.on('window:maximized-changed', listener)
      return () => ipcRenderer.removeListener('window:maximized-changed', listener)
    },
  },
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check-release'),
    downloadAndInstall: (installerUrl, version) =>
      ipcRenderer.invoke('updater:download-and-install', {
        installerUrl,
        version,
      }),
    onDownloadProgress: (callback) => {
      if (typeof callback !== 'function') {
        return () => {}
      }

      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('updater:download-progress', listener)
      return () => ipcRenderer.removeListener('updater:download-progress', listener)
    },
  },
})
