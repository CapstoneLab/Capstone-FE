const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const { spawn } = require('node:child_process')

const isDev = !app.isPackaged
const devServerUrl = 'http://localhost:5173'
const defaultGithubRepo = 'CapstoneLab/Capstone-FE'
const appRootDir = path.join(__dirname, '..')

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
      'User-Agent': 'SecuPipeline-Desktop-Updater',
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

function pickInstallerAsset(assets) {
  if (!Array.isArray(assets)) {
    return null
  }

  const exeAssets = assets.filter((asset) =>
    typeof asset?.name === 'string' ? asset.name.toLowerCase().endsWith('.exe') : false,
  )

  if (exeAssets.length === 0) {
    return null
  }

  const setupAsset = exeAssets.find((asset) => asset.name.toLowerCase().includes('setup'))
  return setupAsset || exeAssets[0]
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
      appName: 'SecuPipeline',
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
    appName: 'SecuPipeline',
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
  const fileName = `secupipeline-${safeVersion}-setup.exe`
  const targetDir = path.join(app.getPath('temp'), 'secupipeline-updates')
  const targetPath = path.join(targetDir, fileName)

  await fs.promises.mkdir(targetDir, { recursive: true })

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'SecuPipeline-Desktop-Updater',
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

const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://ec2-54-221-222-244.compute-1.amazonaws.com/capstonelab/capstone-back'
const DEFAULT_AUTH_LOGIN_URL = `${apiBaseUrl}/auth/github/login`

const ALLOWED_AUTH_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  (() => { try { return new URL(apiBaseUrl).hostname } catch { return '' } })(),
].filter(Boolean))

function isAllowedAuthUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
    return ALLOWED_AUTH_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

ipcMain.handle('auth:open-github-login', async (event, payload) => {
  const requested = typeof payload?.url === 'string' && payload.url.trim()
  const target =
    requested && isAllowedAuthUrl(requested)
      ? requested
      : process.env.AUTH_LOGIN_URL && isAllowedAuthUrl(process.env.AUTH_LOGIN_URL)
        ? process.env.AUTH_LOGIN_URL
        : DEFAULT_AUTH_LOGIN_URL

  const parentWindow = BrowserWindow.fromWebContents(event.sender)

  const authWindow = new BrowserWindow({
    width: 600,
    height: 700,
    parent: parentWindow || undefined,
    modal: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  authWindow.once('ready-to-show', () => authWindow.show())

  return new Promise((resolve) => {
    let resolved = false

    const checkForToken = (url) => {
      try {
        const parsed = new URL(url)
        const token = parsed.searchParams.get('token')
        if (token && parsed.pathname.includes('/auth/success')) {
          if (!resolved) {
            resolved = true
            event.sender.send('auth:token-received', token)
            authWindow.close()
            resolve({ opened: true, url: target, token })
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    authWindow.webContents.on('will-redirect', (_e, url) => checkForToken(url))
    authWindow.webContents.on('did-navigate', (_e, url) => checkForToken(url))
    authWindow.webContents.on('did-navigate-in-page', (_e, url) => checkForToken(url))

    authWindow.on('closed', () => {
      if (!resolved) {
        resolved = true
        resolve({ opened: true, url: target, token: null })
      }
    })

    authWindow.loadURL(target)
  })
})

ipcMain.handle('app:get-info', () => {
  return {
    appName: 'SecuPipeline',
    version: normalizeVersion(app.getVersion()),
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
