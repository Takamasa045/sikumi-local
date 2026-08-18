import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
      exclude: [
        'src/server.ts',
        'src/test/**',
        'src/packs/zip-fixture.ts',
        'src/distribution/cli.ts',
      ],
    },
  },
})
