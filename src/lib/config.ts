const DEFAULT_API_BASE_URL = 'https://api.pwd.kr/capstonelab/capstone-back'

export const REMOTE_API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/+$/, '')

// Electron development loads the renderer from Vite's localhost origin. Route
// API fetches through Vite there so the browser never performs a cross-origin
// request. Packaged Electron (`file:`) and deployed web builds use the real URL.
export const API_BASE_URL =
  import.meta.env.DEV && window.location.protocol !== 'file:'
    ? '/api-proxy'
    : REMOTE_API_BASE_URL

// OAuth must be a top-level navigation to the actual backend, not an AJAX
// request through the development proxy.
export const githubLoginUrl = `${REMOTE_API_BASE_URL}/auth/github/login`
