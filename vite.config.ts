import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBaseUrl = env.VITE_API_BASE_URL || 'https://112.186.136.153'
  const apiOrigin = new URL(apiBaseUrl).origin
  // Strip trailing slashes so `/api-proxy/auth/me` never becomes
  // `//auth/me` when the configured API URL has the root pathname (`/`).
  const apiPath = new URL(apiBaseUrl).pathname.replace(/\/+$/, '')

  return {
  base: './',
  build: {
    outDir: 'renderer-dist',
    emptyOutDir: true,
  },
  plugins: [
    tailwindcss(),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    proxy: {
      '/api-proxy': {
        target: apiOrigin,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, apiPath),
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  }
})
