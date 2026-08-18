import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import type {
  CanonicalEvent,
  ProviderRunSpecification,
} from '@sikumi-local/provider-sdk'
import {
  createClaudeProvider,
  resolveFakeClaudePath,
  resolvePermissionBrokerPath,
} from './adapter.js'
import {
  claudeSchemaFinalizationArgs,
  CLAUDE_SCHEMA_FINALIZATION_DISALLOWED_TOOLS,
  mapClaudePermissions,
  PERMISSION_PROMPT_TOOL,
} from './permissions.js'
import { mapClaudeStreamEvent } from './map-event.js'

const directories: string[] = []
const adapters: Array<ReturnType<typeof createClaudeProvider>> = []

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.dispose()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Claude permissions and mapping', () => {
  it('never maps to bypassPermissions', () => {
    expect(mapClaudePermissions('research').permissionMode).toBe('dontAsk')
    expect(mapClaudePermissions('plan').permissionMode).toBe('plan')
    expect(() => mapClaudePermissions('unrestricted')).toThrow(AppError)
    expect(PERMISSION_PROMPT_TOOL).toBe(
      'mcp__shikumi_permission_broker__request_permission',
    )
    expect(
      mapClaudeStreamEvent('r', { type: 'thinking', thinking: 'hidden' }, 't'),
    ).toBeNull()
    expect(mapClaudePermissions('observe').disallowedTools).toContain('Bash')
    expect(mapClaudePermissions('edit-worktree').permissionMode).toBe(
      'acceptEdits',
    )
    expect(mapClaudePermissions('test-worktree').allowedTools).toContain('Bash')
    expect(() => mapClaudePermissions('publish')).toThrow(AppError)
    const finalization = claudeSchemaFinalizationArgs({
      sessionId: 'sess',
      schema: { type: 'object' },
    })
    expect(finalization[finalization.indexOf('--permission-mode') + 1]).toBe(
      'dontAsk',
    )
    expect(finalization).not.toContain('--allowedTools')
    expect(finalization).not.toContain('bypassPermissions')
    expect(finalization).not.toContain('acceptEdits')
    expect(finalization[finalization.indexOf('--disallowedTools') + 1]).toBe(
      CLAUDE_SCHEMA_FINALIZATION_DISALLOWED_TOOLS,
    )
    for (const tool of ['Edit', 'Write', 'Bash', 'WebSearch', 'WebFetch']) {
      expect(CLAUDE_SCHEMA_FINALIZATION_DISALLOWED_TOOLS.split(',')).toContain(
        tool,
      )
    }
    expect(
      mapClaudeStreamEvent('r', { type: 'system', subtype: 'init' }, 't')?.type,
    ).toBe('run.started')
    expect(mapClaudeStreamEvent('r', { type: 'assistant' }, 't')?.type).toBe(
      'run.state_changed',
    )
    expect(
      mapClaudeStreamEvent('r', { type: 'result', subtype: 'error' }, 't')
        ?.type,
    ).toBe('run.failed')
    expect(
      mapClaudeStreamEvent('r', { type: 'tool_use', name: 'WebSearch' }, 't')
        ?.type,
    ).toBe('web.search')
    expect(
      mapClaudeStreamEvent('r', { type: 'tool_use', name: 'Read' }, 't')?.type,
    ).toBe('repository.read')
    expect(
      mapClaudeStreamEvent('r', { type: 'tool_use', name: 'Bash' }, 't')?.type,
    ).toBe('tool.started')
  })
})

describe('Claude adapter', () => {
  it('probes without storing credentials and completes a stream-json job', async () => {
    const adapter = track(createFixtureAdapter())
    const probe = await adapter.probe()
    expect(probe.installed).toBe(true)
    expect(probe.authenticated).toBe(true)
    expect(probe.transport).toBe('stream-json')
    expect(probe.warnings[0]).toMatch(/does not store/i)
    const handle = await adapter.startRun(specification(trackDir(), '調べて'))
    const events = await collect(handle)
    expect(handle.providerSessionId).toBe('claude-sess-1')
    expect(events.some((event) => event.type === 'run.started')).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'artifact.created' &&
          typeof event.content === 'string',
      ),
    ).toBe(true)
    expect(events.some((event) => event.type === 'artifact.created')).toBe(true)
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)
    expect((await adapter.getCapabilities()).structuredOutput).toBe(true)
    await expect(
      adapter.respondToQuestion('q', { text: 'n' }),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('reports unauthenticated CLI and missing binary', async () => {
    const unauthed = track(
      createClaudeProvider({
        executable: process.execPath,
        argsPrefix: [resolveFakeClaudePath()],
        probeCwd: trackDir(),
        parentEnv: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
        },
        capture: async (request) => {
          if (request.args.includes('auth')) {
            return {
              code: 1,
              signal: null,
              stdout: '{"loggedIn":false}',
              stderr: '',
              timedOut: false,
            }
          }
          return {
            code: 0,
            signal: null,
            stdout: '2.1.220-fixture',
            stderr: '',
            timedOut: false,
          }
        },
      }),
    )
    expect((await unauthed.probe()).authenticated).toBe(false)
    const missing = track(
      createClaudeProvider({
        resolveCommand: () => undefined,
        probeCwd: trackDir(),
      }),
    )
    expect((await missing.probe()).installed).toBe(false)
  })

  it('surfaces broker approvals and cancel', async () => {
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

    const before = new Set(listBrokerDirs())
    const hanging = await adapter.startRun(
      specification(trackDir(), '[hang]待って'),
    )
    const created = listBrokerDirs().filter((name) => !before.has(name))
    expect(created).toHaveLength(1)
    await adapter.cancelRun(hanging.runId)
    const cancelled = await collect(hanging)
    expect(cancelled.at(-1)?.type).toBe('run.cancelled')
    expect(existsSync(join(tmpdir(), created[0] ?? ''))).toBe(false)
  })

  it('requires a matching one-shot decision for consecutive approvals', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const handle = await adapter.startRun(
      specification(trackDir(), '[approvals]調べて'),
    )
    const events: CanonicalEvent[] = []
    const requested: string[] = []
    const consumption = (async () => {
      for await (const event of handle.events()) {
        events.push(event)
        if (event.type === 'approval.requested') {
          requested.push(event.requestId)
          await adapter.respondToApproval(
            event.requestId,
            requested.length === 1 ? 'denied' : 'approved',
          )
        }
      }
    })()
    await consumption
    expect(requested).toEqual(['claude-apr-1', 'claude-apr-2'])
    expect(
      events.filter((event) => event.type === 'approval.requested'),
    ).toHaveLength(2)
    expect(events.some((event) => event.type === 'approval.resolved')).toBe(
      false,
    )
    expect(events.some((event) => event.type === 'run.completed')).toBe(true)
  })

  it('finalizes invalid stream output via resume json-schema without inheriting tools', async () => {
    const adapter = track(createFixtureAdapter())
    await adapter.probe()
    const handle = await adapter.startRun(
      specification(trackDir(), '[invalid-schema]調べて'),
    )
    const events = await collect(handle)
    const completed = events.find((event) => event.type === 'run.completed')
    expect(completed).toMatchObject({ type: 'run.completed' })
    expect(completed).not.toMatchObject({ invalidResult: true })
    expect(
      events.some(
        (event) =>
          event.type === 'artifact.created' && event.artifactType === 'report',
      ),
    ).toBe(true)
  })
})

function listBrokerDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) =>
    name.startsWith('sikumi-claude-broker-'),
  )
}

function createFixtureAdapter(env: Record<string, string> = {}) {
  return createClaudeProvider({
    executable: process.execPath,
    argsPrefix: [resolveFakeClaudePath()],
    brokerPath: resolvePermissionBrokerPath(),
    probeCwd: trackDir(),
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

function track(adapter: ReturnType<typeof createClaudeProvider>) {
  adapters.push(adapter)
  return adapter
}

function trackDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-claude-'))
  directories.push(directory)
  return directory
}
