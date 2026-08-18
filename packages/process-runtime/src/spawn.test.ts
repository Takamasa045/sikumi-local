import { EventEmitter } from 'node:events'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFakeCliPath, resolveLingerChildPath } from './fixtures.js'
import {
  adoptSpawnedProcess,
  isProcessAlive,
  spawnManagedProcess,
} from './spawn.js'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

const fakeCli = resolveFakeCliPath()
const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('spawnManagedProcess', () => {
  it('starts the fake CLI, parses JSONL, and strips reasoning and secrets', async () => {
    const cwd = createTempCwd()
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [fakeCli, '--scenario', 'fail'],
      cwd,
      allowedCwdRoots: [cwd],
    })

    const eventsPromise = collect(child.jsonl)
    const [events, exit] = await Promise.all([eventsPromise, child.wait()])

    expect(exit.code).toBe(1)
    expect(exit.outputOverflowed).toBe(false)
    expect(events[0]).toMatchObject({ type: 'run.started' })
    expect(events.at(-1)).toMatchObject({ type: 'run.failed' })
    expect(JSON.stringify(events)).not.toContain(
      'INTERNAL_REASONING_MUST_NOT_PERSIST',
    )
    expect(JSON.stringify(events)).not.toContain('FAKE_SECRET_TOKEN')
    expect(JSON.stringify(events)).not.toContain('should-not-persist-on-stderr')
    expect(isProcessAlive(child.pid)).toBe(false)
    expect(() => child.writeStdin('{"decision":"approved"}')).toThrow(AppError)
    await child.cancel()
  })

  it('resolves the linger-child fixture next to the fake CLI', () => {
    expect(resolveLingerChildPath().endsWith('linger-child.mjs')).toBe(true)
  })

  it('passes metacharacter arguments literally instead of invoking a shell', async () => {
    const cwd = createTempCwd()
    const dangerous = 'hello; rm -rf / && echo pwned'
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [fakeCli, '--scenario', 'echo-arg', '--value', dangerous],
      cwd,
      allowedCwdRoots: [cwd],
    })

    const events = await collect(child.jsonl)
    await child.wait()

    expect(events).toEqual([{ type: 'arg.echo', value: dangerous }])
  })

  it('does not leak parent secrets or NODE_OPTIONS into the child', async () => {
    const cwd = createTempCwd()
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [fakeCli, '--scenario', 'print-env'],
      cwd,
      allowedCwdRoots: [cwd],
      parentEnv: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        AWS_SECRET_ACCESS_KEY: 'aws-should-not-leak',
        GITHUB_TOKEN: 'ghp-should-not-leak',
        NODE_OPTIONS: '--require ./evil.js',
        OPENAI_API_KEY: 'sk-parent',
      },
    })

    const events = await collect(child.jsonl)
    await child.wait()
    const snapshot = events[0] as {
      keys: string[]
      hasAwsSecret: boolean
      hasGithubToken: boolean
      hasNodeOptions: boolean
      hasOpenAiKey: boolean
    }

    expect(snapshot.hasAwsSecret).toBe(false)
    expect(snapshot.hasGithubToken).toBe(false)
    expect(snapshot.hasNodeOptions).toBe(false)
    expect(snapshot.hasOpenAiKey).toBe(false)
    expect(snapshot.keys).not.toContain('AWS_SECRET_ACCESS_KEY')
    expect(snapshot.keys).not.toContain('GITHUB_TOKEN')
    expect(JSON.stringify(events)).not.toContain('aws-should-not-leak')
  })

  it('cancels a hanging process group including descendants', async () => {
    const cwd = createTempCwd()
    const pidFile = join(cwd, 'child.pid')
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [fakeCli, '--scenario', 'spawn-child', '--pid-file', pidFile],
      cwd,
      allowedCwdRoots: [cwd],
    })

    const descendantPid = await waitForPidFile(pidFile)
    expect(isProcessAlive(child.pid)).toBe(true)
    expect(isProcessAlive(descendantPid)).toBe(true)

    await child.cancel()
    const exit = await child.wait()

    expect(exit.cancelled).toBe(true)
    expect(isProcessAlive(child.pid)).toBe(false)
    await waitUntilDead(descendantPid)
  })

  it('times out a hanging process group without leaving descendants', async () => {
    const cwd = createTempCwd()
    const pidFile = join(cwd, 'timeout-child.pid')
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [fakeCli, '--scenario', 'spawn-child', '--pid-file', pidFile],
      cwd,
      allowedCwdRoots: [cwd],
      timeoutMs: 200,
    })

    const descendantPid = await waitForPidFile(pidFile)
    const exit = await child.wait()

    expect(exit.timedOut).toBe(true)
    expect(isProcessAlive(child.pid)).toBe(false)
    await waitUntilDead(descendantPid)
  })

  it('rejects a non-executable file before spawn', () => {
    const cwd = createTempCwd()
    const file = join(cwd, 'notes.txt')
    writeFileSync(file, 'not an executable\n')
    chmodSync(file, 0o644)

    expect(() =>
      spawnManagedProcess({
        executable: file,
        args: [],
        cwd,
        allowedCwdRoots: [cwd],
      }),
    ).toThrow(AppError)
  })

  it('folds a disappeared-executable race into AppError without leaking errors', async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number | undefined
    }
    child.pid = undefined

    expect(() =>
      adoptSpawnedProcess(child as unknown as ChildProcessWithoutNullStreams),
    ).toThrow(AppError)

    const leaked: unknown[] = []
    const onUnhandled = (error: unknown) => {
      leaked.push(error)
    }
    process.once('uncaughtException', onUnhandled)
    child.emit('error', new Error('ENOENT'))
    await Promise.resolve()
    process.removeListener('uncaughtException', onUnhandled)
    expect(leaked).toEqual([])
  })

  it('rejects shell injection, path traversal, and unregistered cwd', () => {
    const cwd = createTempCwd()

    expect(() =>
      spawnManagedProcess({
        executable: `${process.execPath}; rm -rf /`,
        args: [fakeCli],
        cwd,
        allowedCwdRoots: [cwd],
      }),
    ).toThrow(AppError)

    expect(() =>
      spawnManagedProcess({
        executable: process.execPath,
        args: [fakeCli],
        cwd: `${cwd}/../`,
        allowedCwdRoots: [cwd],
      }),
    ).toThrow(AppError)

    expect(() =>
      spawnManagedProcess({
        executable: process.execPath,
        args: [fakeCli],
        cwd,
        allowedCwdRoots: [join(cwd, 'not-registered')],
      }),
    ).toThrow(AppError)
  })

  it('refuses to spawn a shell even when the binary exists', () => {
    const cwd = createTempCwd()
    expect(() =>
      spawnManagedProcess({
        executable: '/bin/sh',
        args: ['-c', 'echo pwned'],
        cwd,
        allowedCwdRoots: [cwd],
      }),
    ).toThrow(AppError)
    expect(() =>
      spawnManagedProcess({
        executable: '/bin/bash',
        args: ['-c', 'rm -rf /'],
        cwd,
        allowedCwdRoots: [cwd],
      }),
    ).toThrow(AppError)
  })

  it('keeps a concatenated injection string as a single argv element', async () => {
    const cwd = createTempCwd()
    const injection = 'ok; $(reboot) && echo pwned | cat'
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [fakeCli, '--scenario', 'echo-arg', '--value', injection],
      cwd,
      allowedCwdRoots: [cwd],
    })
    const events = await collect(child.jsonl)
    await child.wait()
    expect(events).toEqual([{ type: 'arg.echo', value: injection }])
  })

  it('completes an approval handshake over stdin', async () => {
    const cwd = createTempCwd()
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [fakeCli, '--scenario', 'complete'],
      cwd,
      allowedCwdRoots: [cwd],
    })

    const seen: Record<string, unknown>[] = []
    const consume = (async () => {
      for await (const event of child.jsonl) {
        seen.push(event)
        if (event.type === 'approval.requested') {
          child.writeStdin(JSON.stringify({ decision: 'approved' }))
        }
      }
    })()

    const exit = await child.wait()
    await consume

    expect(exit.code).toBe(0)
    expect(seen.map((event) => event.type)).toContain('artifact.created')
    expect(seen.at(-1)).toMatchObject({ type: 'run.completed' })
  })

  it('stops the process group on the first oversized JSONL line', async () => {
    const cwd = createTempCwd()
    const pidFile = join(cwd, 'line-overflow.pid')
    const script = join(cwd, 'huge-line.mjs')
    writeFileSync(
      script,
      [
        `import { spawn } from 'node:child_process'`,
        `import { existsSync, writeSync } from 'node:fs'`,
        `spawn(process.execPath, ${JSON.stringify([resolveLingerChildPath(), pidFile])}, { stdio: 'ignore', shell: false })`,
        `while (!existsSync(${JSON.stringify(pidFile)})) {`,
        `  await new Promise((resolve) => setTimeout(resolve, 10))`,
        `}`,
        `writeSync(1, JSON.stringify({ type: 'too', pad: 'x'.repeat(200) }) + '\\n')`,
        `writeSync(1, JSON.stringify({ type: 'run.started', summary: 'ok', reasoning: 'hidden', token: 'sk-live-secret1234' }) + '\\n')`,
        `setInterval(() => {}, 1000)`,
      ].join('\n'),
    )
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [script],
      cwd,
      allowedCwdRoots: [cwd],
      maxJsonlLineBytes: 64,
    })
    const descendantPid = await waitForPidFile(pidFile)
    const eventsPromise = collect(child.jsonl)
    const [events, exit] = await Promise.all([eventsPromise, child.wait()])

    expect(exit.outputOverflowed).toBe(true)
    expect(exit.cancelled).toBe(false)
    expect(exit.timedOut).toBe(false)
    expect(isProcessAlive(child.pid)).toBe(false)
    await waitUntilDead(descendantPid)
    expect(
      events.some(
        (event) =>
          event.type === 'runtime.output_overflow' &&
          event.diagnostic === 'output_overflow',
      ),
    ).toBe(true)
    expect(events.some((event) => event.type === 'run.started')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('hidden')
    expect(JSON.stringify(events)).not.toContain('sk-live-secret1234')
  })

  it('stops the process group when the JSONL queue rejects a push', async () => {
    const cwd = createTempCwd()
    const pidFile = join(cwd, 'queue-overflow.pid')
    const script = join(cwd, 'flood.mjs')
    writeFileSync(
      script,
      [
        `import { spawn } from 'node:child_process'`,
        `import { existsSync, writeSync } from 'node:fs'`,
        `spawn(process.execPath, ${JSON.stringify([resolveLingerChildPath(), pidFile])}, { stdio: 'ignore', shell: false })`,
        `while (!existsSync(${JSON.stringify(pidFile)})) {`,
        `  await new Promise((resolve) => setTimeout(resolve, 10))`,
        `}`,
        `writeSync(1, Array.from({ length: 20 }, (_, i) => JSON.stringify({ type: 'tick', i })).join('\\n') + '\\n')`,
        `setInterval(() => {}, 1000)`,
      ].join('\n'),
    )
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: [script],
      cwd,
      allowedCwdRoots: [cwd],
      maxJsonlQueueItems: 3,
    })
    const descendantPid = await waitForPidFile(pidFile)
    const exit = await child.wait()
    const events = await collect(child.jsonl)

    expect(exit.outputOverflowed).toBe(true)
    expect(exit.cancelled).toBe(false)
    expect(exit.timedOut).toBe(false)
    expect(isProcessAlive(child.pid)).toBe(false)
    await waitUntilDead(descendantPid)
    expect(events).toEqual([
      { type: 'tick', i: 0 },
      { type: 'tick', i: 1 },
      { type: 'tick', i: 2 },
    ])
  })

  it('rejects a non-positive maxJsonlQueueItems before spawn', () => {
    const cwd = createTempCwd()
    for (const maxJsonlQueueItems of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        spawnManagedProcess({
          executable: process.execPath,
          args: ['-e', 'process.exit(0)'],
          cwd,
          allowedCwdRoots: [cwd],
          maxJsonlQueueItems,
        }),
      ).toThrow(AppError)
    }
  })

  it('rejects a non-positive maxJsonlQueueItems on adopt', () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number | undefined
    }
    child.pid = 1
    expect(() =>
      adoptSpawnedProcess(
        child as unknown as ChildProcessWithoutNullStreams,
        undefined,
        { maxJsonlQueueItems: 0 },
      ),
    ).toThrow(AppError)
  })
})

function createTempCwd(): string {
  const directory = join(
    tmpdir(),
    `sikumi-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  tempDirectories.push(directory)
  return directory
}

async function collect(
  events: AsyncIterable<Record<string, unknown>>,
): Promise<Record<string, unknown>[]> {
  const collected: Record<string, unknown>[] = []
  for await (const event of events) {
    collected.push(event)
  }
  return collected
}

async function waitUntilDead(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
  expect(isProcessAlive(pid)).toBe(false)
}

async function waitForPidFile(path: string): Promise<number> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const pid = Number(readFileSync(path, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) {
        return pid
      }
    } catch {
      // The child has not written the pid file yet.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }
  throw new Error(`Timed out waiting for pid file ${path}`)
}
