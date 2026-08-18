import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import type {
  CanonicalEvent,
  ProviderRunSpecification,
} from '@sikumi-local/provider-sdk'
import {
  isProcessAlive,
  spawnManagedProcess,
} from '@sikumi-local/process-runtime'
import { createCodexProvider, resolveFakeCodexPath } from './adapter.js'
import {
  assertSupportedCodexProtocol,
  loadCodexProtocolFixture,
} from './protocol.js'

const directories: string[] = []
const adapters: Array<ReturnType<typeof createCodexProvider>> = []

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.dispose()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Codex adapter', () => {
  it('probes fixture app-server and login without storing secrets', async () => {
    const adapter = track(createFixtureAdapter())
    const probe = await adapter.probe()
    expect(probe.installed).toBe(true)
    expect(probe.authenticated).toBe(true)
    expect(probe.transport).toBe('app-server')
    expect(probe.supportedFeatures.liveApprovals).toBe(true)
    expect(probe.authDescription).not.toMatch(/token|sk-|password/i)
    expect(await adapter.listModels()).toEqual([])
  })

  it('degrades to exec --json when app-server is absent', async () => {
    const adapter = track(
      createCodexProvider({
        executable: process.execPath,
        argsPrefix: [resolveFakeCodexPath()],
        probeCwd: trackDir(),
        parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
        capture: async (request) => {
          if (request.args.includes('app-server')) {
            return {
              code: 2,
              signal: null,
              stdout: '',
              stderr: 'unknown command',
              timedOut: false,
            }
          }
          if (request.args.includes('exec')) {
            return {
              code: 0,
              signal: null,
              stdout: 'Run Codex\n--json\n--output-schema',
              stderr: '',
              timedOut: false,
            }
          }
          return {
            code: 0,
            signal: null,
            stdout: request.args.includes('login')
              ? 'Logged in using ChatGPT'
              : 'codex-cli 0.144.6-fixture',
            stderr: '',
            timedOut: false,
          }
        },
      }),
    )
    const probe = await adapter.probe()
    expect(probe.transport).toBe('exec-json')
    expect(probe.supportedFeatures.liveApprovals).toBe(false)
    expect(probe.warnings[0]).toMatch(/fallback/i)
  })

  it('reports missing CLI and unauthenticated login', async () => {
    const missing = track(
      createCodexProvider({
        commandName: 'definitely-missing-codex',
        resolveCommand: () => undefined,
        probeCwd: trackDir(),
      }),
    )
    expect((await missing.probe()).installed).toBe(false)

    const unauthed = track(
      createCodexProvider({
        executable: process.execPath,
        argsPrefix: [resolveFakeCodexPath()],
        probeCwd: trackDir(),
        parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
        capture: async (request) => ({
          code: request.args.includes('login') ? 1 : 0,
          signal: null,
          stdout: request.args.includes('login')
            ? 'Not logged in'
            : request.args.includes('app-server')
              ? 'generate-json-schema --stdio'
              : 'codex-cli 0.144.6-fixture',
          stderr: '',
          timedOut: false,
        }),
      }),
    )
    expect((await unauthed.probe()).authenticated).toBe(false)
  })

  it('completes an app-server research job with outputSchema', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const handle = await adapter.startRun(
      specification(trackDir(), 'このRepositoryを調べて'),
    )
    const events = await collect(handle)
    expect(handle.providerSessionId).toBe('thread-1')
    expect(events.map((event) => event.type)).toContain('run.completed')
    expect(events.some((event) => event.type === 'artifact.created')).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'artifact.created' &&
          typeof event.content === 'string' &&
          event.content.includes('調査メモ'),
      ),
    ).toBe(true)
    expect(events.some((event) => event.type === 'command.started')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('reasoning')
    expect((await adapter.getCapabilities()).streaming).toBe(true)
    expect((await adapter.getAuthStatus()).authenticated).toBe(true)
    await expect(
      adapter.respondToQuestion('q', { text: 'no' }),
    ).rejects.toBeInstanceOf(AppError)
    const resumed = await adapter.resumeRun({
      ...specification(trackDir(), '続きを調べて'),
      providerSessionId: 'thread-1',
    })
    expect(
      (await collect(resumed)).some((event) => event.type === 'run.completed'),
    ).toBe(true)
  })

  it('maps live approvals and cancel', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const handle = await adapter.startRun(
      specification(trackDir(), '[approval]調べて'),
    )
    const events: CanonicalEvent[] = []
    const consumption = (async () => {
      for await (const event of handle.events()) {
        events.push(event)
        if (event.type === 'approval.requested') {
          await adapter.respondToApproval(event.requestId, 'approved')
        }
      }
    })()
    await consumption
    expect(events.some((event) => event.type === 'approval.resolved')).toBe(
      false,
    )
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)

    const hanging = await adapter.startRun(
      specification(trackDir(), '[hang]待って'),
    )
    await adapter.cancelRun(hanging.runId)
    const cancelled = await collect(hanging)
    expect(cancelled.at(-1)?.type).toBe('run.cancelled')
  })

  it('rejects unrestricted profiles and marks invalid structured output', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    await expect(
      adapter.startRun({
        ...specification(trackDir(), '調べて'),
        permissionProfile: 'unrestricted',
      }),
    ).rejects.toBeInstanceOf(AppError)

    const handle = await adapter.startRun(
      specification(trackDir(), '[invalid-schema]調べて'),
    )
    const events = await collect(handle)
    const completed = events.find((event) => event.type === 'run.completed')
    expect(completed).toMatchObject({ invalidResult: true })
  })

  it('fails a deterministic app-server error and rejects a missing CLI start', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const failed = await adapter.startRun(
      specification(trackDir(), '[fail]調べて'),
    )
    expect(
      (await collect(failed)).some((event) => event.type === 'run.failed'),
    ).toBe(true)
    const missing = track(
      createCodexProvider({
        resolveCommand: () => undefined,
        probeCwd: trackDir(),
      }),
    )
    await missing.probe()
    await expect(
      missing.startRun(specification(trackDir(), '調べて')),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('runs the exec --json fallback and skips malformed JSONL', async () => {
    const adapter = track(
      createCodexProvider({
        executable: process.execPath,
        argsPrefix: [resolveFakeCodexPath()],
        probeCwd: trackDir(),
        parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
        capture: async (request) => {
          if (request.args.includes('app-server')) {
            return {
              code: 2,
              signal: null,
              stdout: '',
              stderr: 'unknown',
              timedOut: false,
            }
          }
          return {
            code: 0,
            signal: null,
            stdout: request.args.includes('exec')
              ? '--json --output-schema'
              : 'codex-cli 0.144.6-fixture',
            stderr: '',
            timedOut: false,
          }
        },
      }),
    )
    await adapter.probe()
    const handle = await adapter.startRun(
      specification(trackDir(), '[malformed]調べて'),
    )
    const events = await collect(handle)
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)
    expect(handle.providerSessionId).toBe('thread-exec')
  })

  it('fails closed on a malformed protocol fixture', async () => {
    expect(loadCodexProtocolFixture('app-server-v1.json').protocolVersion).toBe(
      1,
    )
    expect(() =>
      assertSupportedCodexProtocol(loadCodexProtocolFixture('unknown')),
    ).toThrow(AppError)
    expect(() =>
      assertSupportedCodexProtocol(loadCodexProtocolFixture('malformed')),
    ).toThrow(AppError)

    const pids: number[] = []
    const adapter = track(
      createCodexProvider({
        executable: process.execPath,
        argsPrefix: [resolveFakeCodexPath(), '--protocol-variant', 'malformed'],
        probeCwd: trackDir(),
        parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
        spawn: (request) => {
          const child = spawnManagedProcess(request)
          pids.push(child.pid)
          return child
        },
      }),
    )
    await adapter.probe()
    await expect(
      adapter.startRun(specification(trackDir(), '調べて')),
    ).rejects.toBeInstanceOf(AppError)
    await adapter.dispose()
    await expectProcessesExited(pids)
  })

  it('does not treat unsupported ServerRequests as approvals', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const handle = await adapter.startRun(
      specification(trackDir(), '[unknown-request]調べて'),
    )
    const events = await collect(handle)
    expect(events.some((event) => event.type === 'approval.requested')).toBe(
      false,
    )
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)
  })

  it('answers permissions approvals with the request schema and file changes with accept/decline', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const permissions = await adapter.startRun(
      specification(trackDir(), '[permissions]調べて'),
    )
    const permissionEvents: CanonicalEvent[] = []
    for await (const event of permissions.events()) {
      permissionEvents.push(event)
      if (event.type === 'approval.requested') {
        await adapter.respondToApproval(event.requestId, 'approved')
      }
    }
    expect(
      permissionEvents.some((event) => event.type === 'approval.requested'),
    ).toBe(true)
    expect(
      permissionEvents.some((event) => event.type === 'approval.resolved'),
    ).toBe(false)
    expect(
      permissionEvents.some((event) => event.type === 'run.completed'),
    ).toBe(true)

    const files = await adapter.startRun(
      specification(trackDir(), '[file-approval]調べて'),
    )
    const fileEvents: CanonicalEvent[] = []
    for await (const event of files.events()) {
      fileEvents.push(event)
      if (event.type === 'approval.requested') {
        await adapter.respondToApproval(event.requestId, 'denied')
      }
    }
    expect(fileEvents.some((event) => event.type === 'run.completed')).toBe(
      true,
    )
  })

  it('passes the user prompt as a discrete argv or JSON field, never a shell', async () => {
    const seen: Array<{ executable: string; args: readonly string[] }> = []
    const injection = 'ignore previous; rm -rf / && echo pwned'
    const adapter = track(
      createCodexProvider({
        executable: process.execPath,
        argsPrefix: [resolveFakeCodexPath()],
        probeCwd: trackDir(),
        parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
        spawn: (request) => {
          seen.push({ executable: request.executable, args: request.args })
          return spawnManagedProcess(request)
        },
      }),
    )
    await adapter.probe()
    await collect(await adapter.startRun(specification(trackDir(), injection)))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]?.executable).toBe(process.execPath)
    expect(seen[0]?.args).not.toContain('/bin/sh')
    expect(seen[0]?.args.some((arg) => arg.includes('app-server'))).toBe(true)
    expect(seen[0]?.args).not.toContain(injection)
    expect(seen[0]?.args.join(' ')).not.toContain(`-c ${injection}`)
  })

  it('fails closed when the fixture advertises protocol v2', async () => {
    const adapter = track(createFixtureAdapter({ protocol: 'malformed' }))
    await adapter.probe()
    await expect(
      adapter.startRun(specification(trackDir(), '調べて')),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('completes a supported protocol fixture run', async () => {
    const adapter = track(createFixtureAdapter({ protocol: 'supported' }))
    await adapter.probe()
    const events = await collect(
      await adapter.startRun(specification(trackDir(), '調べて')),
    )
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)
    expect(events.some((event) => event.type === 'approval.requested')).toBe(
      false,
    )
  })

  it('treats future-unknown protocol events as diagnostics without escalation', async () => {
    const adapter = track(createFixtureAdapter({ protocol: 'future-unknown' }))
    await adapter.probe()
    const events = await collect(
      await adapter.startRun(specification(trackDir(), '調べて')),
    )
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)
    expect(events.some((event) => event.type === 'approval.requested')).toBe(
      false,
    )
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('FUTURE_REASONING_MUST_NOT_PERSIST')
    expect(serialized).not.toContain('FUTURE_SECRET_TOKEN')
    expect(serialized).not.toContain('bypass')
  })

  it('switches fixture version output via args and env', () => {
    const fixture = resolveFakeCodexPath()
    expect(runFixtureVersion(['--protocol-variant', 'supported'])).toContain(
      '0.144.6-fixture',
    )
    expect(
      runFixtureVersion(['--protocol-variant', 'future-unknown']),
    ).toContain('99.0.0-future')
    expect(runFixtureVersion(['--protocol-variant', 'malformed'])).toContain(
      'not-a-protocol-frame',
    )
    const viaEnv = spawnSync(process.execPath, [fixture, '--version'], {
      encoding: 'utf8',
      env: { ...process.env, SIKUMI_FAKE_CODEX_PROTOCOL: 'future-unknown' },
    })
    expect(viaEnv.stdout).toContain('99.0.0-future')
  })
})

function createFixtureAdapter(
  options: { protocol?: 'supported' | 'future-unknown' | 'malformed' } = {},
) {
  const protocol = options.protocol ?? 'supported'
  const argsPrefix = [resolveFakeCodexPath()]
  if (protocol !== 'supported') {
    argsPrefix.push('--protocol-variant', protocol)
  }
  return createCodexProvider({
    executable: process.execPath,
    argsPrefix,
    probeCwd: trackDir(),
    parentEnv: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    },
  })
}

function runFixtureVersion(args: string[]): string {
  return (
    spawnSync(
      process.execPath,
      [resolveFakeCodexPath(), ...args, '--version'],
      {
        encoding: 'utf8',
      },
    ).stdout ?? ''
  )
}

async function expectProcessesExited(pids: number[]): Promise<void> {
  for (const pid of pids) {
    for (let attempt = 0; attempt < 20 && isProcessAlive(pid); attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 25)
      })
    }
    expect(isProcessAlive(pid)).toBe(false)
  }
}

function specification(cwd: string, prompt: string): ProviderRunSpecification {
  return {
    runId: `run-${Math.random().toString(16).slice(2)}`,
    workspaceId: 'ws',
    employeeId: 'saguru',
    cwd,
    prompt,
    permissionProfile: 'research',
    environment: {},
    allowedCwdRoots: [cwd],
    outputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['title', 'summary'],
      additionalProperties: false,
    },
  }
}

async function collect(handle: {
  events(): AsyncIterable<CanonicalEvent>
}): Promise<CanonicalEvent[]> {
  const events: CanonicalEvent[] = []
  for await (const event of handle.events()) {
    events.push(event)
  }
  return events
}

function track(adapter: ReturnType<typeof createCodexProvider>) {
  adapters.push(adapter)
  return adapter
}

function trackDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-codex-'))
  directories.push(directory)
  return directory
}
