import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const webPort = Number(process.env.SIKUMI_WEB_PORT ?? 5184)
const serverPort = Number(process.env.SIKUMI_LOCAL_PORT ?? 4321)

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
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
