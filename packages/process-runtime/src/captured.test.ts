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

  it('fails closed on oversized output without leaking secrets or reasoning', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'sikumi-capture-huge-')))
    await expect(
      runCapturedProcess({
        executable: process.execPath,
        args: [
          '-e',
          'process.stdout.write("あ".repeat(80) + "sk-live-secret1234\\nreasoning: hidden\\n")',
        ],
        cwd,
        allowedCwdRoots: [cwd],
        maxOutputBytes: 24,
        timeoutMs: 4_000,
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'OUTPUT_TOO_LARGE',
    })
  })

  it('keeps a complete UTF-8 character at the exact byte limit', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'sikumi-capture-utf8-')))
    const result = await runCapturedProcess({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("あ")'],
      cwd,
      allowedCwdRoots: [cwd],
      maxOutputBytes: 3,
      timeoutMs: 4_000,
    })
    expect(result.stdout).toBe('あ')
    expect(result.stdout).not.toContain('\uFFFD')
  })
})

function track(directory: string): string {
  directories.push(directory)
  return directory
}
