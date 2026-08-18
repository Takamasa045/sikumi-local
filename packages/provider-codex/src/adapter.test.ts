import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import type {
  CanonicalEvent,
  ProviderRunSpecification,
} from '@sikumi-local/provider-sdk'
import { createCodexProvider, resolveFakeCodexPath } from './adapter.js'

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
})

function createFixtureAdapter(env: Record<string, string> = {}) {
  const probeCwd = trackDir()
  return createCodexProvider({
    executable: process.execPath,
    argsPrefix: [resolveFakeCodexPath()],
    probeCwd,
    parentEnv: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    },
  })
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
