import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBaseUrl = env.VITE_API_BASE_URL || 'http://ec2-54-221-222-244.compute-1.amazonaws.com/capstonelab/capstone-back'
  const apiOrigin = new URL(apiBaseUrl).origin
  const apiPath = new URL(apiBaseUrl).pathname

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
