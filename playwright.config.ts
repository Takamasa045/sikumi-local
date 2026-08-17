import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const e2eDataDirectory = mkdtempSync(join(tmpdir(), 'sikumi-local-e2e-'))
process.env.SIKUMI_E2E_DATA_DIR = e2eDataDirectory

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://127.0.0.1:5184',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @sikumi-local/server dev',
      url: 'http://127.0.0.1:4321/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        SIKUMI_LOCAL_DATA_DIR: e2eDataDirectory,
        SIKUMI_LOCAL_HOST: '127.0.0.1',
        SIKUMI_LOCAL_PORT: '4321',
      },
    },
    {
      command: 'pnpm --filter @sikumi-local/web dev',
      url: 'http://127.0.0.1:5184',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
