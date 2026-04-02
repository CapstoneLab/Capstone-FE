export {}

declare global {
  type DesktopReleaseInfo = {
    appName: string
    repository: string
    currentVersion: string
    latestVersion: string
    hasUpdate: boolean
    installerName: string | null
    installerUrl: string | null
    releaseUrl: string | null
    publishedAt: string | null
    statusMessage?: string | null
  }

  type DesktopDownloadProgress = {
    percent: number | null
    downloadedBytes: number
    totalBytes: number | null
    completed?: boolean
  }

  interface Window {
    desktop?: {
      app?: string
      appInfo?: {
        get?: () => Promise<{
          appName: string
          version: string
        }>
      }
      window?: {
        minimize?: () => void
        toggleMaximize?: () => void
        close?: () => void
        isMaximized?: () => Promise<boolean>
        onMaximizedChange?: (callback: (isMaximized: boolean) => void) => () => void
      }
      updater?: {
        checkForUpdates?: () => Promise<DesktopReleaseInfo>
        downloadAndInstall?: (installerUrl: string, version: string) => Promise<{ started: boolean }>
        onDownloadProgress?: (callback: (progress: DesktopDownloadProgress) => void) => () => void
      }
    }
  }
}
