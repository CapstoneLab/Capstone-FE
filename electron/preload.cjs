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
  auth: {
    openGithubLogin: (url) => ipcRenderer.invoke('auth:open-github-login', url),
    getSavedToken: () => ipcRenderer.invoke('auth:get-token'),
    setSavedToken: (token) => ipcRenderer.invoke('auth:set-token', token),
    clearSavedToken: () => ipcRenderer.invoke('auth:clear-token'),
    getPendingCallback: () => ipcRenderer.invoke('auth:get-pending-callback'),
    acknowledgeCallback: (url) => ipcRenderer.invoke('auth:ack-callback', url),
    onCallback: (callback) => {
      if (typeof callback !== 'function') {
        return () => {}
      }

      const listener = (_event, url) => {
        callback(url)
        void ipcRenderer.invoke('auth:ack-callback', url)
      }
      ipcRenderer.on('auth:callback', listener)
      return () => ipcRenderer.removeListener('auth:callback', listener)
    },
  },
  report: {
    savePdf: (html, fileName) =>
      ipcRenderer.invoke('report:save-pdf', { html, fileName }),
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
