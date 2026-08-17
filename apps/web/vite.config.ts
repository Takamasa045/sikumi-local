import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5184,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4321',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5184,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4321',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
      exclude: ['src/main.tsx'],
    },
  },
})
