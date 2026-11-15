import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En desarrollo, /api se reenvía al backend FastAPI local (backend/, puerto 8000).
// En producción se usa VITE_API_BASE_URL (ver src/data/api.js).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
