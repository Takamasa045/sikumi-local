import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCapturedProcess } from './captured.js'
import { resolveFakeCliPath } from './fixtures.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('runCapturedProcess', () => {
  it('captures fixture stdout without inheriting disallowed environment', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'sikumi-capture-')))
    const result = await runCapturedProcess({
      executable: process.execPath,
      args: [resolveFakeCliPath(), '--scenario', 'echo-arg', '--value', 'ok'],
      cwd,
      allowedCwdRoots: [cwd],
      parentEnv: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        AWS_SECRET_ACCESS_KEY: 'should-not-leak',
      },
      timeoutMs: 4_000,
    })

    expect(result.timedOut).toBe(false)
    expect(result.stdout).toContain('"value":"ok"')
    expect(result.stdout).not.toContain('should-not-leak')
  })

  it('times out a hanging fixture and reports timedOut', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'sikumi-capture-hang-')))
    const result = await runCapturedProcess({
      executable: process.execPath,
      args: [resolveFakeCliPath(), '--scenario', 'hang'],
      cwd,
      allowedCwdRoots: [cwd],
      timeoutMs: 80,
    })
    expect(result.timedOut).toBe(true)
  })
})

function track(directory: string): string {
  directories.push(directory)
  return directory
}
