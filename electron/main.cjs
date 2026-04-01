const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')

const isDev = !app.isPackaged
const devServerUrl = 'http://localhost:5173'

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function sendMaximizedState(win) {
  if (!win || win.isDestroyed()) {
    return
  }

  win.webContents.send('window:maximized-changed', win.isMaximized())
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#1E1E1E',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
    },
  })

  if (isDev) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer-dist/index.html'))
  }

  win.webContents.on('will-navigate', (event, url) => {
    const isLocalDev = isDev && url.startsWith(devServerUrl)
    const isPackagedFile = !isDev && url.startsWith('file:')

    if (isLocalDev || isPackagedFile) {
      return
    }

    event.preventDefault()

    if (isSafeExternalUrl(url)) {
      shell.openExternal(url)
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  win.on('maximize', () => sendMaximizedState(win))
  win.on('unmaximize', () => sendMaximizedState(win))
  win.webContents.on('did-finish-load', () => sendMaximizedState(win))
}

ipcMain.handle('window:minimize', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (!target || target.isDestroyed()) {
    return
  }
  target.minimize()
})

ipcMain.handle('window:toggle-maximize', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (!target || target.isDestroyed()) {
    return
  }

  if (target.isMaximized()) {
    target.unmaximize()
  } else {
    target.maximize()
  }
})

ipcMain.handle('window:close', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (!target || target.isDestroyed()) {
    return
  }
  target.close()
})

ipcMain.handle('window:is-maximized', (event) => {
  const target = BrowserWindow.fromWebContents(event.sender)
  if (!target || target.isDestroyed()) {
    return false
  }

  return target.isMaximized()
})

app.whenReady().then(() => {
  app.setAppUserModelId('com.secupipeline.desktop')
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
