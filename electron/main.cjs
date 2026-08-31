const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const { spawn } = require('node:child_process')

const isDev = !app.isPackaged
const devServerUrl = 'http://localhost:5173'
const defaultGithubRepo = 'CapstoneLab/Capstone-FE'
const appRootDir = path.join(__dirname, '..')
const authProtocol = 'secupipeline'
let mainWindow = null
let authWindow = null
let pendingAuthCallback = null

function isAuthCallbackUrl(value) {
  if (typeof value !== 'string') return false

  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === `${authProtocol}:` &&
      parsed.hostname.toLowerCase() === 'auth' &&
      parsed.pathname.replace(/\/+$/, '') === '/callback'
    )
  } catch {
    return false
  }
}

function findAuthCallbackUrl(argv) {
  return Array.isArray(argv) ? argv.find((value) => isAuthCallbackUrl(value)) || null : null
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function receiveAuthCallback(url) {
  if (!isAuthCallbackUrl(url)) return

  pendingAuthCallback = url
  focusMainWindow()

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('auth:callback', url)
  }
}

function registerAuthProtocol() {
  if (process.defaultApp && process.argv[1]) {
    return app.setAsDefaultProtocolClient(authProtocol, process.execPath, [path.resolve(process.argv[1])])
  }

  return app.setAsDefaultProtocolClient(authProtocol)
}

function isAllowedGithubLoginUrl(value) {
  try {
    const candidate = new URL(value)
    const configuredApi = new URL(
      process.env.VITE_API_BASE_URL || 'https://112.186.136.153',
    )
    const apiBasePath = configuredApi.pathname.replace(/\/+$/, '')

    return (
      candidate.protocol === 'https:' &&
      candidate.origin === configuredApi.origin &&
      candidate.pathname.replace(/\/+$/, '') === `${apiBasePath}/auth/github/login`
    )
  } catch {
    return false
  }
}

function isLegacyAuthSuccessUrl(value) {
  try {
    const candidate = new URL(value)
    const configuredApi = new URL(
      process.env.VITE_API_BASE_URL || 'https://112.186.136.153',
    )
    const apiBasePath = configuredApi.pathname.replace(/\/+$/, '')

    return (
      candidate.protocol === 'https:' &&
      candidate.origin === configuredApi.origin &&
      candidate.pathname.replace(/\/+$/, '') === `${apiBasePath}/auth/success`
    )
  } catch {
    return false
  }
}

function isJwtLike(value) {
  return (
    typeof value === 'string' &&
    value.length <= 16_384 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.trim())
  )
}

async function openGithubLoginWindow(loginUrl) {
  if (!isAllowedGithubLoginUrl(loginUrl)) {
    throw new Error('허용되지 않은 GitHub 로그인 URL입니다.')
  }

  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus()
    return
  }

  authWindow = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    show: false,
    autoHideMenuBar: true,
    title: 'GitHub 로그인',
    backgroundColor: '#1E1E1E',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
    },
  })

  const finishLogin = (event, url) => {
    if (!isAuthCallbackUrl(url)) return false
    event?.preventDefault()
    receiveAuthCallback(url)
    authWindow?.close()
    return true
  }

  authWindow.webContents.on('will-redirect', (event, url) => finishLogin(event, url))
  authWindow.webContents.on('will-navigate', (event, url) => finishLogin(event, url))
  authWindow.webContents.on('did-finish-load', async () => {
    const loginWindow = authWindow
    if (!loginWindow || loginWindow.isDestroyed()) return

    const currentUrl = loginWindow.webContents.getURL()
    if (!isLegacyAuthSuccessUrl(currentUrl)) return

    try {
      const parsed = new URL(currentUrl)
      let token =
        parsed.searchParams.get('token') ||
        parsed.searchParams.get('access_token') ||
        parsed.searchParams.get('jwt') ||
        ''

      // Compatibility for the backend's temporary success page, which renders
      // the JWT in a textarea instead of redirecting to the custom protocol.
      if (!isJwtLike(token)) {
        token = await loginWindow.webContents.executeJavaScript(
          "document.querySelector('textarea')?.value?.trim() || ''",
          true,
        )
      }

      if (!isJwtLike(token)) return
      receiveAuthCallback(`secupipeline://auth/callback?token=${encodeURIComponent(token.trim())}`)
      loginWindow.close()
    } catch {
      // Leave the temporary success page visible if its format is unknown.
    }
  })
  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthCallbackUrl(url)) {
      receiveAuthCallback(url)
      authWindow?.close()
    } else if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  authWindow.once('ready-to-show', () => authWindow?.show())
  authWindow.on('closed', () => {
    authWindow = null
    focusMainWindow()
  })
  try {
    await authWindow.loadURL(loginUrl)
  } catch (error) {
    authWindow?.close()
    throw error
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const callbackUrl = findAuthCallbackUrl(argv)
    if (callbackUrl) receiveAuthCallback(callbackUrl)
    focusMainWindow()
  })
}

// macOS delivers a custom protocol URL through open-url instead of argv.
app.on('open-url', (event, url) => {
  event.preventDefault()
  receiveAuthCallback(url)
})

function normalizeRepoValue(value) {
  if (typeof value !== 'string') {
    return null
  }

  const candidate = value.trim()
  if (!candidate) {
    return null
  }

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate)
      const segments = parsed.pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => segment.trim())

      if (segments.length >= 2) {
        return `${segments[0]}/${segments[1]}`
      }

      return null
    } catch {
      return null
    }
  }

  if (!candidate.includes('/')) {
    return null
  }

  const [owner, repo] = candidate.split('/')
  if (!owner || !repo) {
    return null
  }

  return `${owner.trim()}/${repo.trim()}`
}

function getRepositoryFromPackageJson() {
  try {
    const packageJsonPath = path.join(appRootDir, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const explicitRepo = normalizeRepoValue(packageJson.releaseRepository)

    if (explicitRepo) {
      return explicitRepo
    }

    if (typeof packageJson.repository === 'string') {
      return normalizeRepoValue(packageJson.repository)
    }

    if (typeof packageJson.repository?.url === 'string') {
      return normalizeRepoValue(packageJson.repository.url)
    }

    return null
  } catch {
    return null
  }
}

const fallbackGithubRepo = getRepositoryFromPackageJson() || defaultGithubRepo

app.setName('Secupipeline')

function getAppIconPath() {
  const candidates = [
    path.join(appRootDir, 'renderer-dist', 'app-logo.ico'),
    path.join(appRootDir, 'renderer-dist', 'app-logo.png'),
    path.join(appRootDir, 'public', 'app-logo.ico'),
    path.join(appRootDir, 'public', 'app-logo.png'),
  ]

  return candidates.find((candidate) => fs.existsSync(candidate))
}

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^"|"$/g, '')

    if (!key || process.env[key] !== undefined) {
      continue
    }

    process.env[key] = value
  }
}

loadDotEnvFile(path.join(appRootDir, '.env'))
loadDotEnvFile(path.join(appRootDir, '.env.local'))

function normalizeVersion(version) {
  if (typeof version !== 'string') {
    return '0.0.0'
  }

  return version.trim().replace(/^v/i, '')
}

function compareSemver(a, b) {
  const aParts = normalizeVersion(a)
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  const bParts = normalizeVersion(b)
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)

  for (let i = 0; i < 3; i += 1) {
    const aValue = aParts[i] ?? 0
    const bValue = bParts[i] ?? 0

    if (aValue > bValue) {
      return 1
    }

    if (aValue < bValue) {
      return -1
    }
  }

  return 0
}

function getReleaseRepository() {
  const envValue =
    process.env.GITHUB_RELEASE_REPO ||
    process.env.GITHUB_RELEASE_REPO_URL ||
    process.env.GITHUB_REPOSITORY
  return normalizeRepoValue(envValue) || fallbackGithubRepo
}

function getGithubAuthHeader() {
  const token = process.env.GITHUB_RELEASE_TOKEN?.trim()
  if (!token) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

function buildReleaseError({ status, repository, apiMessage }) {
  const hasToken = Boolean(process.env.GITHUB_RELEASE_TOKEN?.trim())

  if (status === 401 || status === 403) {
    return `릴리즈 조회 실패 (HTTP ${status}): GitHub 토큰 권한이 부족합니다. repo 읽기 권한(PAT) 확인이 필요합니다. 대상 저장소 ${repository}`
  }

  if (status === 404) {
    if (!hasToken) {
      return `릴리즈 조회 실패 (HTTP 404): private 저장소이거나 접근 권한이 없습니다. .env.local에 GITHUB_RELEASE_TOKEN을 설정하세요. 대상 저장소 ${repository}`
    }

    return `릴리즈 조회 실패 (HTTP 404): 저장소 또는 릴리즈를 찾지 못했습니다. 대상 저장소 ${repository}`
  }

  if (apiMessage) {
    return `릴리즈 조회 실패 (HTTP ${status}): ${apiMessage}`
  }

  return `릴리즈 조회 실패 (HTTP ${status})`
}

async function requestGithubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Secupipeline-Desktop-Updater',
      ...getGithubAuthHeader(),
    },
  })

  const payload = await response.json().catch(() => null)

  return {
    ok: response.ok,
    status: response.status,
    data: payload,
  }
}

function isAllowedDownloadUrl(url) {
  try {
    const parsed = new URL(url)

    if (parsed.protocol !== 'https:') {
      return false
    }

    const hostname = parsed.hostname.toLowerCase()
    return (
      hostname.endsWith('github.com') ||
      hostname.endsWith('githubusercontent.com') ||
      hostname.endsWith('githubassets.com')
    )
  } catch {
    return false
  }
}

function pickInstallerAsset(assets, platform = process.platform, architecture = process.arch) {
  if (!Array.isArray(assets)) {
    return null
  }

  const extension = platform === 'darwin' ? '.dmg' : platform === 'win32' ? '.exe' : null
  if (!extension) return null

  const installerAssets = assets.filter((asset) =>
    typeof asset?.name === 'string' ? asset.name.toLowerCase().endsWith(extension) : false,
  )

  if (installerAssets.length === 0) {
    return null
  }

  if (platform === 'darwin') {
    const architectureAsset = installerAssets.find((asset) =>
      asset.name.toLowerCase().includes(`-${architecture}.`),
    )
    return architectureAsset || installerAssets[0]
  }

  const setupAsset = installerAssets.find((asset) => asset.name.toLowerCase().includes('setup'))
  return setupAsset || installerAssets[0]
}

async function fetchLatestRelease() {
  const repository = getReleaseRepository()
  const currentVersion = normalizeVersion(app.getVersion())
  const latestEndpoint = `https://api.github.com/repos/${repository}/releases/latest`
  const listEndpoint = `https://api.github.com/repos/${repository}/releases?per_page=10`

  const latestResponse = await requestGithubJson(latestEndpoint)
  let release = null

  if (latestResponse.ok) {
    release = latestResponse.data
  } else if (latestResponse.status === 404) {
    const listResponse = await requestGithubJson(listEndpoint)

    if (!listResponse.ok) {
      const apiMessage =
        typeof listResponse.data?.message === 'string' ? listResponse.data.message : null
      throw new Error(
        buildReleaseError({
          status: listResponse.status,
          repository,
          apiMessage,
        }),
      )
    }

    const releases = Array.isArray(listResponse.data) ? listResponse.data : []
    release = releases.find((item) => item && !item.draft) || null
  } else {
    const apiMessage =
      typeof latestResponse.data?.message === 'string' ? latestResponse.data.message : null
    throw new Error(
      buildReleaseError({
        status: latestResponse.status,
        repository,
        apiMessage,
      }),
    )
  }

  if (!release) {
    return {
      appName: 'Secupipeline',
      repository,
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      installerName: null,
      installerUrl: null,
      releaseUrl: null,
      publishedAt: null,
      statusMessage: '게시된 릴리즈가 없습니다.',
    }
  }

  const installerAsset = pickInstallerAsset(release.assets)
  const latestVersion = normalizeVersion(release.tag_name || release.name || currentVersion)

  return {
    appName: 'Secupipeline',
    repository,
    currentVersion,
    latestVersion,
    hasUpdate: compareSemver(latestVersion, currentVersion) > 0,
    installerName: installerAsset?.name ?? null,
    installerUrl: installerAsset?.browser_download_url ?? null,
    releaseUrl: release.html_url ?? null,
    publishedAt: release.published_at ?? null,
    statusMessage: null,
  }
}

async function downloadInstaller(url, version, onProgress) {
  const safeVersion = normalizeVersion(version || 'latest').replace(/[^0-9A-Za-z._-]/g, '') || 'latest'
  let extension = process.platform === 'darwin' ? '.dmg' : '.exe'
  try {
    const urlExtension = path.extname(new URL(url).pathname).toLowerCase()
    if (urlExtension === '.exe' || urlExtension === '.dmg') extension = urlExtension
  } catch {
    // Keep the platform-specific fallback extension.
  }
  const fileName = `secupipeline-${safeVersion}-setup${extension}`
  const targetDir = path.join(app.getPath('temp'), 'secupipeline-updates')
  const targetPath = path.join(targetDir, fileName)

  await fs.promises.mkdir(targetDir, { recursive: true })

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Secupipeline-Desktop-Updater',
      ...getGithubAuthHeader(),
    },
  })

  if (!response.ok || !response.body) {
    throw new Error(`업데이트 파일 다운로드 실패 (HTTP ${response.status})`)
  }

  const totalBytesRaw = Number.parseInt(response.headers.get('content-length') || '0', 10)
  const totalBytes = Number.isFinite(totalBytesRaw) && totalBytesRaw > 0 ? totalBytesRaw : null
  const sourceStream = Readable.fromWeb(response.body)
  let downloadedBytes = 0
  let lastPercent = -1
  let lastEmitAt = 0

  if (typeof onProgress === 'function') {
    onProgress({
      percent: totalBytes ? 0 : null,
      downloadedBytes: 0,
      totalBytes,
    })
  }

  sourceStream.on('data', (chunk) => {
    const chunkSize = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
    downloadedBytes += chunkSize

    if (typeof onProgress !== 'function') {
      return
    }

    if (totalBytes) {
      const percent = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress({
          percent,
          downloadedBytes,
          totalBytes,
        })
      }
      return
    }

    const now = Date.now()
    if (now - lastEmitAt >= 300) {
      lastEmitAt = now
      onProgress({
        percent: null,
        downloadedBytes,
        totalBytes: null,
      })
    }
  })

  await pipeline(sourceStream, fs.createWriteStream(targetPath))

  if (typeof onProgress === 'function') {
    onProgress({
      percent: 100,
      downloadedBytes,
      totalBytes,
      completed: true,
    })
  }

  return targetPath
}

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
  const isMacOS = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    icon: getAppIconPath(),
    backgroundColor: '#1E1E1E',
    frame: isMacOS,
    titleBarStyle: isMacOS ? 'hiddenInset' : 'hidden',
    ...(isMacOS ? { trafficLightPosition: { x: 14, y: 12 } } : {}),
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
  mainWindow = win

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
  win.webContents.on('did-finish-load', () => {
    if (pendingAuthCallback) win.webContents.send('auth:callback', pendingAuthCallback)
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
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

const AUTH_STORE_FILE = 'auth-session.json'

function authStorePath() {
  return path.join(app.getPath('userData'), AUTH_STORE_FILE)
}

function readSavedAuthToken() {
  try {
    const raw = fs.readFileSync(authStorePath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return typeof parsed?.token === 'string' ? parsed.token : null
  } catch {
    return null
  }
}

function writeSavedAuthToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    return false
  }

  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(
      authStorePath(),
      JSON.stringify({ token, savedAt: new Date().toISOString() }),
      'utf-8',
    )
    return true
  } catch (error) {
    console.error('[auth] failed to persist token:', error)
    return false
  }
}

function clearSavedAuthToken() {
  try {
    fs.rmSync(authStorePath(), { force: true })
    return true
  } catch (error) {
    console.error('[auth] failed to clear token:', error)
    return false
  }
}

ipcMain.handle('auth:get-token', () => readSavedAuthToken())
ipcMain.handle('auth:set-token', (_event, token) => writeSavedAuthToken(token))
ipcMain.handle('auth:clear-token', () => clearSavedAuthToken())
ipcMain.handle('auth:open-github-login', async (_event, loginUrl) => {
  await openGithubLoginWindow(loginUrl)
  return true
})
ipcMain.handle('auth:get-pending-callback', () => pendingAuthCallback)
ipcMain.handle('auth:ack-callback', (_event, callbackUrl) => {
  if (pendingAuthCallback === callbackUrl) pendingAuthCallback = null
})

ipcMain.handle('app:get-info', () => {
  return {
    appName: 'Secupipeline',
    version: normalizeVersion(app.getVersion()),
    platform: process.platform,
  }
})

// Render the security report HTML to a real PDF. Electron's window.print()
// has no preview in the desktop print dialog, so the renderer hands the report
// HTML here: we load it into an offscreen window, printToPDF, then prompt for a
// save location and open the result.
ipcMain.handle('report:save-pdf', async (event, payload) => {
  const html = typeof payload?.html === 'string' ? payload.html : ''
  const fileName =
    typeof payload?.fileName === 'string' && payload.fileName.trim()
      ? payload.fileName.replace(/[^\w.-]+/g, '_')
      : 'security-report.pdf'
  if (!html) return { ok: false, error: 'empty-html' }

  const tmpHtml = path.join(os.tmpdir(), `secupipeline-report-${Date.now()}.html`)
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })

  try {
    await fs.promises.writeFile(tmpHtml, html, 'utf8')
    await pdfWindow.loadFile(tmpHtml)
    // Give web fonts a beat to settle so the PDF matches the on-screen design.
    await new Promise((resolve) => setTimeout(resolve, 300))

    const data = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'custom', top: 0.55, bottom: 0.55, left: 0.55, right: 0.55 },
    })

    const parentWindow = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePath } = await dialog.showSaveDialog(parentWindow || undefined, {
      title: '보고서 PDF 저장',
      defaultPath: fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { ok: false, canceled: true }

    await fs.promises.writeFile(filePath, data)
    shell.openPath(filePath)
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  } finally {
    pdfWindow.destroy()
    fs.promises.unlink(tmpHtml).catch(() => {})
  }
})

ipcMain.handle('updater:check-release', async () => {
  return fetchLatestRelease()
})

ipcMain.handle('updater:download-and-install', async (event, payload) => {
  const installerUrl = payload?.installerUrl
  const version = payload?.version

  if (typeof installerUrl !== 'string' || !installerUrl.trim()) {
    throw new Error('설치 파일 URL이 유효하지 않습니다.')
  }

  if (!isAllowedDownloadUrl(installerUrl)) {
    throw new Error('허용되지 않은 다운로드 URL입니다.')
  }

  const sendProgress = (progressPayload) => {
    if (!event.sender || event.sender.isDestroyed()) {
      return
    }

    event.sender.send('updater:download-progress', progressPayload)
  }

  const installerPath = await downloadInstaller(installerUrl, version, sendProgress)

  if (process.platform === 'darwin') {
    const openError = await shell.openPath(installerPath)
    if (openError) throw new Error(openError)
    return { started: true }
  }

  if (process.platform !== 'win32') {
    throw new Error('Unsupported desktop update platform.')
  }

  spawn(installerPath, [], {
    detached: true,
    stdio: 'ignore',
  }).unref()

  setTimeout(() => {
    app.quit()
  }, 250)

  return {
    started: true,
  }
})

app.whenReady().then(() => {
  app.setAppUserModelId('com.secupipeline.desktop')
  registerAuthProtocol()
  createWindow()

  const initialCallbackUrl = findAuthCallbackUrl(process.argv)
  if (initialCallbackUrl) receiveAuthCallback(initialCallbackUrl)

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
