import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // UI dev server; API requests go to `npm run api` (wrangler pages dev) on 8788
    proxy: { '/api': 'http://localhost:8788' },
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { chunkSizeWarningLimit: 2000 },
})
