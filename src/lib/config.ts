export const DEFAULT_API_BASE_URL = 'https://112.186.136.153'

export const REMOTE_API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, '')

function toWebSocketBaseUrl(httpBaseUrl: string): string {
  const baseUrl = /^https?:\/\//i.test(httpBaseUrl)
    ? httpBaseUrl
    : typeof window !== 'undefined'
      ? new URL(httpBaseUrl || '/', window.location.origin).toString()
      : httpBaseUrl

  return baseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '')
}

const remoteWsApiBaseUrl = (
  import.meta.env.VITE_WS_BASE_URL || toWebSocketBaseUrl(REMOTE_API_BASE_URL)
).replace(/\/+$/, '')

const isViteBrowserDevelopment =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.location.protocol !== 'file:'

export const WS_API_BASE_URL = isViteBrowserDevelopment
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api-proxy`
  : remoteWsApiBaseUrl

// Electron development loads the renderer from Vite's localhost origin. Route
// API fetches through Vite there so the browser never performs a cross-origin
// request. Packaged Electron (`file:`) and deployed web builds use the real URL.
export const API_BASE_URL =
  isViteBrowserDevelopment
    ? '/api-proxy'
    : REMOTE_API_BASE_URL

// OAuth must be a top-level navigation to the actual backend, not an AJAX
// request through the development proxy.
export const githubLoginUrl = `${REMOTE_API_BASE_URL}/auth/github/login`
