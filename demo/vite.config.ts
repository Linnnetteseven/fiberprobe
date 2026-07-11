import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Import SDK directly from source — no build step needed for demo
      'fnn-ts': path.resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    proxy: {
      // Proxy /rpc/* to the local FNN node to avoid CORS
      '/rpc': {
        target: 'http://127.0.0.1:8227',
        rewrite: (p) => p.replace(/^\/rpc/, ''),
        changeOrigin: true,
      },
    },
  },
})
