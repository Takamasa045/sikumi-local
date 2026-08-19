import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  observerFailedDir,
  observerInboxDir,
  runObserverBridge,
  writeSpoolEvent,
} from '@sikumi-local/observer-bridge'
import { createClaudeCodeObserverAdapter } from '@sikumi-local/observer-claude-code'
import { createClaudeDesktopObserverAdapter } from '@sikumi-local/observer-claude-desktop'
import { createCodexObserverAdapter } from '@sikumi-local/observer-codex'
import { createCursorObserverAdapter } from '@sikumi-local/observer-cursor'
import { createGrokObserverAdapter } from '@sikumi-local/observer-grok'
import {
  OBSERVER_MAX_BATCH_COUNT,
  OBSERVER_STALE_AFTER_MS,
  projectInboundEvent,
} from '@sikumi-local/observer-core'
import { buildApp } from '../app.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { injectAuthed, injectPublic } from '../test/http.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('phase 8 adapter compatibility matrix', () => {
  it('normalizes supported, future, malformed, and missing-tool shapes without storing bodies', async () => {
    const adapters = [
      {
        id: 'codex',
        adapter: createCodexObserverAdapter(),
        event: { hook_event_name: 'SessionStart', session_id: 'c1' },
      },
      {
        id: 'cursor',
        adapter: createCursorObserverAdapter(),
        event: { hook_event_name: 'sessionStart', conversation_id: 'u1' },
      },
      {
        id: 'grok-build',
        adapter: createGrokObserverAdapter(),
        event: { type: 'SessionStart', session_id: 'g1' },
      },
      {
        id: 'claude-code',
        adapter: createClaudeCodeObserverAdapter(),
        event: { hook_event_name: 'SessionStart', session_id: 'l1' },
      },
      {
        id: 'claude-desktop',
        adapter: createClaudeDesktopObserverAdapter(),
        event: { type: 'sikumi.begin_work', sessionId: 'cd_deadbeefdeadbeef' },
      },
    ] as const

    for (const item of adapters) {
      const health = await item.adapter.healthCheck({
        homeDir: track(createTemporaryDirectory()),
        dataDirectory: track(createTemporaryDirectory()),
      })
      expect(health.status).not.toBe('error')
      const supported = item.adapter.normalize({
        ...item.event,
        prompt: 'do not store this prompt',
        response: 'hidden response',
        tool_output: 'tool body',
      })
      expect(supported).not.toBeNull()
      expect(JSON.stringify(supported)).not.toContain(
        'do not store this prompt',
      )
      expect(JSON.stringify(supported)).not.toContain('hidden response')
      expect(JSON.stringify(supported)).not.toContain('tool body')

      const future = item.adapter.normalize({
        hook_event_name: 'FutureHypotheticalEvent',
        type: 'FutureHypotheticalEvent',
        prompt: 'future prompt body',
        future_field: { nested: 'keep-out' },
      })
      if (future) {
        expect(future.normalizedType).toBe('activity.changed')
        expect(JSON.stringify(future)).not.toContain('future prompt body')
        expect(JSON.stringify(future)).not.toContain('keep-out')
      }
      expect(item.adapter.normalize(null)).toBeNull()
      expect(item.adapter.normalize('nope')).toBeNull()
    }
  })

  it('validates generated Codex/Cursor/Grok/Claude Code artifacts and MCPB format', async () => {
    const home = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const dataDirectory = track(createTemporaryDirectory())
    const adapters = [
      createCodexObserverAdapter(),
      createCursorObserverAdapter(),
      createGrokObserverAdapter(),
      createClaudeCodeObserverAdapter(),
    ]
    for (const adapter of adapters) {
      const preview = await adapter.install({ homeDir: home, repoDir: repo })
      expect(preview.requiresConfirm).toBe(true)
      const applied = await adapter.install({
        homeDir: home,
        repoDir: repo,
        confirm: true,
        ...digestFields(preview),
      })
      expect(applied.applied).toBe(true)
    }
    expect(() =>
      JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')),
    ).not.toThrow()
    expect(() =>
      JSON.parse(readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8')),
    ).not.toThrow()
    expect(() =>
      JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')),
    ).not.toThrow()
    const grokToml = readFileSync(join(home, '.grok', 'config.toml'), 'utf8')
    expect(grokToml).toContain('sikumi-observer')
    expect(grokToml).toContain('command = ')

    const desktop = createClaudeDesktopObserverAdapter()
    const preview = await desktop.install({ dataDirectory })
    const applied = await desktop.install({
      dataDirectory,
      confirm: true,
      ...digestFields(preview),
    })
    expect(applied.applied).toBe(true)
    expect(existsSync(join(dataDirectory, 'observer', 'claude-desktop'))).toBe(
      true,
    )
    expect(existsSync(join(home, 'Library'))).toBe(false)
  })
})

describe('phase 8 event flood, dedupe, and spool bounds', () => {
  it('deduplicates concurrent idempotency keys and stays bounded', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = createApp(dataDirectory)
    const started = Date.now()
    const payload = {
      source: 'codex',
      nativeEventType: 'heartbeat',
      session_id: 'flood-dup',
      occurredAt: '2026-08-18T08:00:00.000Z',
    }
    const [first, second, third] = await Promise.all([
      injectAuthed(app, {
        method: 'POST',
        url: '/api/observer/events',
        payload,
      }),
      injectAuthed(app, {
        method: 'POST',
        url: '/api/observer/events',
        payload,
      }),
      injectAuthed(app, {
        method: 'POST',
        url: '/api/observer/events',
        payload,
      }),
    ])
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(third.statusCode).toBe(201)
    expect(
      new Set([
        first.json().event.id,
        second.json().event.id,
        third.json().event.id,
      ]).size,
    ).toBe(1)

    const events = []
    for (let index = 0; index < 80; index += 1) {
      events.push({
        source: 'cursor',
        nativeEventType: 'heartbeat',
        session_id: `flood-${index}`,
        occurredAt: `2026-08-18T08:01:${String(index % 60).padStart(2, '0')}.000Z`,
      })
    }
    const tooMany = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events/batch',
      payload: { events },
    })
    expect([400, 413]).toContain(tooMany.statusCode)

    const accepted = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events/batch',
      payload: { events: events.slice(0, OBSERVER_MAX_BATCH_COUNT) },
    })
    expect(accepted.statusCode).toBe(201)
    expect(accepted.json().events).toHaveLength(OBSERVER_MAX_BATCH_COUNT)
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('processes thousands of unique events, then rejects a later oversized spool while keeping valid later entries', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const first = createApp(dataDirectory)
    await injectAuthed(first, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const started = Date.now()
    for (let index = 0; index < 1_200; index += 1) {
      writeSpoolEvent(
        dataDirectory,
        projectInboundEvent({
          source: 'codex',
          nativeEventType: 'heartbeat',
          session_id: `stress-${index}`,
          cwd: repo,
          occurredAt: new Date(
            Date.parse('2026-08-18T09:00:00.000Z') + index * 1000,
          ).toISOString(),
        }),
      )
    }
    const inbox = observerInboxDir(dataDirectory, 'codex')
    writeFileSync(
      join(inbox, '000-broken-then-valid.ndjson'),
      [
        '{not-json',
        JSON.stringify({
          source: 'codex',
          nativeEventType: 'SessionStart',
          session_id: 'after-broken',
          cwd: repo,
          occurredAt: '2026-08-18T12:00:00.000Z',
          prompt: 'must vanish',
        }),
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(inbox, 'zzz-oversized.ndjson'),
      `${'x'.repeat(300_000)}\n`,
    )
    await first.close()

    const second = createApp(dataDirectory)
    await second.ready()
    const sessions = await injectPublic(second, {
      method: 'GET',
      url: '/api/external-sessions',
    })
    const listed = sessions.json().sessions as Array<{
      externalSessionId: string | null
    }>
    const ids = listed.map((session) => session.externalSessionId)
    expect(sessions.json().total).toBeGreaterThan(100)
    expect(ids).toContain('after-broken')
    expect(ids.some((id) => id?.startsWith('stress-'))).toBe(true)
    const dumped = readdirSync(observerFailedDir(dataDirectory))
      .map((name) =>
        readFileSync(join(observerFailedDir(dataDirectory), name), 'utf8'),
      )
      .join('\n')
    expect(dumped).toContain('oversized')
    expect(dumped).toContain('json-parse')
    expect(dumped).not.toContain('must vanish')
    const stored = await injectPublic(second, {
      method: 'GET',
      url: '/api/observer/today',
    })
    expect(JSON.stringify(stored.json())).not.toContain('must vanish')
    expect(JSON.stringify(stored.json())).not.toMatch(/\+export const/)
    expect(Date.now() - started).toBeLessThan(30_000)
  }, 40_000)
})

describe('phase 8 restart recovery', () => {
  it('replays spool, marks stale sessions, keeps completed cooperative work, and discovers git-only changes', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const first = createApp(dataDirectory)
    const created = await injectAuthed(first, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectAuthed(first, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        nativeEventType: 'SessionStart',
        session_id: 'stale-soon',
        cwd: repo,
        occurredAt: new Date(
          Date.now() - OBSERVER_STALE_AFTER_MS - 60_000,
        ).toISOString(),
      },
    })
    await injectAuthed(first, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'claude-desktop',
        type: 'sikumi.begin_work',
        sessionId: 'cd_deadbeefdeadbeef',
        cwd: repo,
        occurredAt: '2026-08-18T11:00:00.000Z',
      },
    })
    await injectAuthed(first, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'claude-desktop',
        type: 'sikumi.complete_work',
        sessionId: 'cd_deadbeefdeadbeef',
        cwd: repo,
        occurredAt: '2026-08-18T11:05:00.000Z',
      },
    })
    await first.close()

    writeFileSync(join(repo, 'while-down.ts'), 'export const n = 1\n')
    writeSpoolEvent(
      dataDirectory,
      projectInboundEvent({
        source: 'cursor',
        nativeEventType: 'sessionStart',
        session_id: 'cursor-after-down',
        cwd: repo,
        occurredAt: '2026-08-18T11:10:00.000Z',
      }),
    )
    writeSpoolEvent(
      dataDirectory,
      projectInboundEvent({
        source: 'cursor',
        nativeEventType: 'sessionStart',
        session_id: 'cursor-after-down',
        cwd: repo,
        occurredAt: '2026-08-18T11:10:00.000Z',
      }),
    )

    const second = createApp(dataDirectory)
    const sessions = await injectPublic(second, {
      method: 'GET',
      url: '/api/external-sessions',
    })
    const listed = sessions.json().sessions as Array<{
      source: string
      status: string
      externalSessionId: string | null
    }>
    expect(
      listed.filter(
        (session) => session.externalSessionId === 'cursor-after-down',
      ),
    ).toHaveLength(1)
    expect(
      listed.find((session) => session.externalSessionId === 'stale-soon')
        ?.status,
    ).toBe('stale')
    expect(
      listed.find((session) => session.source === 'claude-desktop')?.status,
    ).toBe('completed')
    const activity = await injectPublic(second, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity`,
    })
    expect(activity.json().activity.changedFileCount).toBeGreaterThan(0)
    expect(JSON.stringify(activity.json())).toContain('変更元不明')
    const events = await injectPublic(second, {
      method: 'GET',
      url: `/api/external-sessions`,
    })
    expect(events.statusCode).toBe(200)
    expect(
      events.json().truncated === true || Array.isArray(events.json().sessions),
    ).toBe(true)
  })
})

describe('phase 8 install lifecycle sandbox', () => {
  it('runs preview → apply → idempotent apply → uninstall for hook adapters without touching real homes', async () => {
    const home = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const userHook = '/tmp/user-hook'
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(
      join(home, '.codex', 'hooks.json'),
      `${JSON.stringify({ keepMe: true, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: userHook }] }] } }, null, 2)}\n`,
    )
    const adapters = [
      createCodexObserverAdapter(),
      createCursorObserverAdapter(),
      createGrokObserverAdapter(),
      createClaudeCodeObserverAdapter(),
    ]
    for (const adapter of adapters) {
      const preview = await adapter.install({ homeDir: home, repoDir: repo })
      expect(preview.changed).toBe(false)
      expect(preview.requiresConfirm).toBe(true)
      const digest = preview.planDigest ?? preview.confirmationToken
      if (!digest) {
        throw new Error(`${adapter.id} preview missing plan digest`)
      }
      const wrong = await adapter.install({
        homeDir: home,
        repoDir: repo,
        confirm: true,
        planDigest: 'wrong-digest',
      })
      expect(wrong.applied).not.toBe(true)
      const applied = await adapter.install({
        homeDir: home,
        repoDir: repo,
        confirm: true,
        confirmationToken: digest,
        planDigest: digest,
      })
      expect(applied.applied).toBe(true)
      const againPreview = await adapter.install({
        homeDir: home,
        repoDir: repo,
      })
      const again = await adapter.install({
        homeDir: home,
        repoDir: repo,
        confirm: true,
        ...digestFields(againPreview),
      })
      expect(again.ok).toBe(true)
      const uninstallPreview = await adapter.uninstall({
        homeDir: home,
        repoDir: repo,
      })
      const removed = await adapter.uninstall({
        homeDir: home,
        repoDir: repo,
        confirm: true,
        ...digestFields(uninstallPreview),
      })
      expect(removed.applied).toBe(true)
    }
    const leftover = readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')
    expect(leftover).toContain(userHook)
    expect(leftover).toContain('keepMe')
    expect(leftover).not.toContain('sikumi-observer-codex')
  })
})

describe('phase 8 scenario G git fallback', () => {
  it('still discovers git changes after a fail-open bridge write', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const inbox = observerInboxDir(dataDirectory, 'codex')
    mkdirSync(inbox, { recursive: true })
    chmodSync(inbox, 0o500)
    const code = await runObserverBridge(['codex', '--root', dataDirectory], {
      stdin: Readable.from([
        JSON.stringify({
          hook_event_name: 'SessionStart',
          session_id: 'bridge-fail',
          cwd: repo,
        }),
      ]),
      stdout: new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      }),
      stderr: new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      }),
      env: {},
    })
    expect(code).toBe(0)
    chmodSync(inbox, 0o700)
    writeFileSync(join(repo, 'after-bridge-fail.ts'), 'export const n = 1\n')
    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const activity = await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${created.json().workspace.repository.id}/activity`,
    })
    expect(activity.json().activity.changedFileCount).toBeGreaterThan(0)
    expect(JSON.stringify(activity.json())).toContain('変更元不明')
  })
})

function createApp(dataDirectory: string) {
  const app = buildApp({ dataDirectory })
  apps.push(app)
  return app
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}

function digestFields(input: {
  readonly confirmationToken?: string
  readonly planDigest?: string
}) {
  return {
    ...(input.confirmationToken === undefined
      ? {}
      : { confirmationToken: input.confirmationToken }),
    ...(input.planDigest === undefined ? {} : { planDigest: input.planDigest }),
  }
}
