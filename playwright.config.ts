import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const e2eDataDirectory =
  process.env.SIKUMI_E2E_DATA_DIR ??
  mkdtempSync(join(tmpdir(), 'sikumi-local-e2e-'))
// Isolated from the live launcher on 4321/5184.
const e2eServerPort = process.env.SIKUMI_E2E_SERVER_PORT ?? '14321'
const e2eWebPort = process.env.SIKUMI_E2E_WEB_PORT ?? '15184'
process.env.SIKUMI_E2E_DATA_DIR = e2eDataDirectory
process.env.SIKUMI_LOCAL_DATA_DIR = e2eDataDirectory

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  // One shared webServer + SQLite data dir owns every spec and project.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${e2eWebPort}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
      // One SQLite store is shared by every spec. Mutating flows stay on
      // desktop; mobile only covers viewport/read-only garden surfaces.
      testMatch: /(?:garden|visual-qa)\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @sikumi-local/server dev',
      url: `http://127.0.0.1:${e2eServerPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        SIKUMI_LOCAL_DATA_DIR: e2eDataDirectory,
        SIKUMI_LOCAL_HOST: '127.0.0.1',
        SIKUMI_LOCAL_PORT: e2eServerPort,
        SIKUMI_WEB_PORT: e2eWebPort,
        SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER: '1',
      },
    },
    {
      command: 'pnpm --filter @sikumi-local/web exec vite --host 127.0.0.1 --port ' + e2eWebPort,
      url: `http://127.0.0.1:${e2eWebPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        SIKUMI_LOCAL_PORT: e2eServerPort,
        SIKUMI_WEB_PORT: e2eWebPort,
      },
    },
  ],
})
