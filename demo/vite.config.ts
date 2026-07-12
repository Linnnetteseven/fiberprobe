import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'fnn-ts': path.resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    proxy: {
      '/rpc-alice': {
        target: 'http://127.0.0.1:8227',
        rewrite: (p) => p.replace(/^\/rpc-alice/, ''),
        changeOrigin: true,
      },
      '/rpc-bob': {
        target: 'http://127.0.0.1:8237',
        rewrite: (p) => p.replace(/^\/rpc-bob/, ''),
        changeOrigin: true,
      },
      '/rpc-carol': {
        target: 'http://127.0.0.1:8247',
        rewrite: (p) => p.replace(/^\/rpc-carol/, ''),
        changeOrigin: true,
      },
    },
  },
})
