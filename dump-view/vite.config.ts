import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/crash': 'http://localhost:8080',
      '/crashes': 'http://localhost:8080',
    },
  },
})
