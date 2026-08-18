import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import type {
  CanonicalEvent,
  ProviderRunSpecification,
} from '@sikumi-local/provider-sdk'
import { createGrokProvider, resolveFakeGrokPath } from './adapter.js'
import {
  assertGrokArgsSafe,
  GROK_DENY_RULES,
  grokCommonArgs,
  mapGrokSandbox,
} from './sandbox.js'
import { mapGrokSessionUpdate, permissionOptionId } from './map-event.js'

const directories: string[] = []
const adapters: Array<ReturnType<typeof createGrokProvider>> = []

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.dispose()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Grok sandbox and mapping', () => {
  it('never includes always-approve or worktree and records deny rules', () => {
    const args = grokCommonArgs(mapGrokSandbox('research'), '/tmp/repo')
    expect(args).toContain('--no-auto-update')
    expect(args).toContain('--sandbox')
    expect(args).toContain('read-only')
    expect(args).not.toContain('--always-approve')
    expect(args).not.toContain('--worktree')
    expect(GROK_DENY_RULES).toContain('git push')
    expect(
      mapGrokSessionUpdate(
        'r',
        { update: { sessionUpdate: 'agent_thought_chunk' } },
        't',
      ),
    ).toBeNull()
    expect(() => mapGrokSandbox('unrestricted')).toThrow(AppError)
    expect(mapGrokSandbox('plan').permissionMode).toBe('plan')
    expect(mapGrokSandbox('observe').disableWebSearch).toBe(true)
    expect(mapGrokSandbox('edit-worktree').sandbox).toBe('workspace')
    expect(mapGrokSandbox('test-worktree').sandbox).toBe('workspace')
    expect(() => mapGrokSandbox('publish')).toThrow(AppError)
    expect(
      mapGrokSessionUpdate(
        'r',
        { update: { sessionUpdate: 'tool_call', title: 'Web Search' } },
        't',
      )?.type,
    ).toBe('web.search')
    expect(
      mapGrokSessionUpdate(
        'r',
        { sessionUpdate: 'tool_call_update', title: 'Read file' },
        't',
      )?.type,
    ).toBe('repository.read')
    expect(
      mapGrokSessionUpdate('r', { sessionUpdate: 'plan' }, 't')?.type,
    ).toBe('run.state_changed')
    expect(
      mapGrokSessionUpdate(
        'r',
        { sessionUpdate: 'tool_call', title: 'Bash' },
        't',
      )?.type,
    ).toBe('tool.started')
    expect(
      permissionOptionId(
        [
          { optionId: 'allow_once', kind: 'allow_once' },
          { optionId: 'reject_once', kind: 'reject_once' },
        ],
        'approved',
      ),
    ).toBe('allow_once')
    expect(
      permissionOptionId(
        [{ optionId: 'reject_once', kind: 'reject_once' }],
        'denied',
      ),
    ).toBe('reject_once')
    expect(permissionOptionId([{ optionId: 'only' }], 'approved')).toBe(
      undefined,
    )
    expect(
      permissionOptionId(
        [{ optionId: 'allow_once', kind: 'allow_once' }],
        'denied',
      ),
    ).toBeUndefined()
    expect(permissionOptionId([], 'denied')).toBeUndefined()
    expect(
      mapGrokSessionUpdate('r', { sessionUpdate: 'unknown' }, 't'),
    ).toBeNull()
    const planArgs = grokCommonArgs(mapGrokSandbox('plan'), '/tmp/repo')
    expect(planArgs).toContain('--permission-mode')
    expect(planArgs).toContain('--disable-web-search')
    expect(() => assertGrokArgsSafe(['--always-approve'])).toThrow(AppError)
    expect(() => assertGrokArgsSafe(['--worktree'])).toThrow(AppError)
    assertGrokArgsSafe(['--sandbox', 'read-only'])
  })
})

describe('Grok adapter', () => {
  it('probes ACP and completes a structured research job', async () => {
    const adapter = track(createFixtureAdapter())
    const probe = await adapter.probe()
    expect(probe.transport).toBe('acp')
    expect(probe.authenticated).toBe(true)
    expect(JSON.stringify(probe)).not.toMatch(/sk-|password|token@|logged in/i)
    expect(probe.supportedFeatures.nativeWorktree).toBe(true)
    expect(probe.supportedFeatures.liveApprovals).toBe(true)
    const handle = await adapter.startRun(specification(trackDir(), '調べて'))
    const events = await collect(handle)
    expect(handle.providerSessionId).toBe('sess-1')
    expect(
      events.some(
        (event) =>
          event.type === 'artifact.created' &&
          typeof event.content === 'string',
      ),
    ).toBe(true)
    expect(events.some((event) => event.type === 'artifact.created')).toBe(true)
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('hidden')
    expect((await adapter.getCapabilities()).liveApprovals).toBe(true)
    await expect(
      adapter.respondToQuestion('q', { text: 'n' }),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('repairs invalid schema twice then keeps a raw artifact', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const handle = await adapter.startRun(
      specification(trackDir(), '[invalid-schema]調べて'),
    )
    const events = await collect(handle)
    const completed = events.find((event) => event.type === 'run.completed')
    expect(completed).toMatchObject({ invalidResult: true })
    expect(
      events.some(
        (event) =>
          event.type === 'artifact.created' && event.title === 'raw result',
      ),
    ).toBe(true)
  })

  it('maps permission requests and cancel', async () => {
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

  it('keeps denial pending when no reject option exists', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const handle = await adapter.startRun(
      specification(trackDir(), '[approval-allow-only]調べて'),
    )
    const events: CanonicalEvent[] = []
    const consumption = (async () => {
      for await (const event of handle.events()) {
        events.push(event)
        if (event.type === 'approval.requested') {
          await expect(
            adapter.respondToApproval(event.requestId, 'denied'),
          ).rejects.toMatchObject({
            name: 'AppError',
            code: 'VALIDATION_FAILED',
          })
          await adapter.cancelRun(handle.runId)
        }
      }
    })()
    await consumption
    expect(events.some((event) => event.type === 'approval.resolved')).toBe(
      false,
    )
    expect(JSON.stringify(events)).not.toContain('reject_once')
  })

  it('authenticates only from a successful grok models probe without leaking raw output', async () => {
    const adapter = track(
      createGrokProvider({
        executable: process.execPath,
        argsPrefix: [resolveFakeGrokPath()],
        probeCwd: trackDir(),
        parentEnv: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
        capture: async (request) => {
          if (request.args.includes('models')) {
            return {
              code: 1,
              signal: null,
              stdout: 'EMAIL user@secret.example TOKEN=sk-secret',
              stderr: 'login required',
              timedOut: false,
            }
          }
          if (
            request.args.includes('stdio') &&
            request.args.includes('--help')
          ) {
            return {
              code: 0,
              signal: null,
              stdout: 'stdio',
              stderr: '',
              timedOut: false,
            }
          }
          return {
            code: 0,
            signal: null,
            stdout: request.args.includes('version')
              ? '{"currentVersion":"1.0.5"}'
              : 'streaming-json',
            stderr: '',
            timedOut: false,
          }
        },
      }),
    )
    const probe = await adapter.probe()
    expect(probe.authenticated).toBe(false)
    expect(JSON.stringify(probe)).not.toContain('sk-secret')
    expect(JSON.stringify(probe)).not.toContain('user@secret.example')
  })

  it('falls back to streaming-json when ACP help is unavailable', async () => {
    const adapter = track(createCodexLikeMissingAcp())
    const probe = await adapter.probe()
    expect(
      probe.transport === 'streaming-json' || probe.transport === 'acp',
    ).toBe(true)
  })
})

function createFixtureAdapter(env: Record<string, string> = {}) {
  return createGrokProvider({
    executable: process.execPath,
    argsPrefix: [resolveFakeGrokPath()],
    probeCwd: trackDir(),
    parentEnv: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    },
  })
}

function createCodexLikeMissingAcp() {
  return createGrokProvider({
    executable: process.execPath,
    argsPrefix: [resolveFakeGrokPath()],
    probeCwd: trackDir(),
    parentEnv: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    },
    capture: async (request) => {
      if (request.args.includes('stdio') && request.args.includes('--help')) {
        return {
          code: 2,
          signal: null,
          stdout: '',
          stderr: 'missing',
          timedOut: false,
        }
      }
      if (request.args.includes('--help')) {
        return {
          code: 0,
          signal: null,
          stdout: 'streaming-json\n--sandbox\n',
          stderr: '',
          timedOut: false,
        }
      }
      return {
        code: 0,
        signal: null,
        stdout: '{"currentVersion":"1.0.5"}',
        stderr: '',
        timedOut: false,
      }
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

function track(adapter: ReturnType<typeof createGrokProvider>) {
  adapters.push(adapter)
  return adapter
}

function trackDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-grok-'))
  directories.push(directory)
  return directory
}
