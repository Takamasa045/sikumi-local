import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { observerInboxDir } from '@sikumi-local/observer-bridge'
import { createCursorObserverAdapter } from './adapter.js'
import { runCursorObserverHook } from './cli.js'
import { missingCursorEvents } from './discovery.js'
import { CURSOR_REQUIRED_HOOK_EVENTS } from './events.js'
import { applyCursorHookMutation } from './install.js'
import { normalizeCursorHook } from './normalize.js'

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('normalizeCursorHook', () => {
  it('maps the 16 required events and keeps Agent vs Tab vs CLI distinct', () => {
    const start = normalizeCursorHook(readFixture('session-start.json'))
    expect(start?.source).toBe('cursor')
    expect(start?.normalizedType).toBe('session.started')
    expect(start?.surface).toBe('cursor-agent')
    expect(JSON.stringify(start)).not.toContain('do not store this prompt')
    expect(JSON.stringify(start)).not.toContain('hidden@example.com')

    const edit = normalizeCursorHook(readFixture('after-file-edit.json'))
    expect(edit?.normalizedType).toBe('file.changed')
    expect(edit?.surface).toBe('cursor-agent')
    expect(edit?.payload.filePath).toBe('src/dashboard/page.tsx')
    expect(JSON.stringify(edit)).not.toContain('secret old')
    expect(JSON.stringify(edit)).not.toContain('full file body')

    const tab = normalizeCursorHook(readFixture('tab-edit.json'))
    expect(tab?.surface).toBe('cursor-tab')
    expect(tab?.normalizedType).toBe('file.changed')
    expect(tab?.externalSessionId?.startsWith('tab:')).toBe(true)

    const shell = normalizeCursorHook(readFixture('shell.json'))
    expect(shell?.normalizedType).toBe('command.started')
    expect(shell?.payload.commandCategory).toBe('test')
    expect(JSON.stringify(shell)).not.toContain(
      'pnpm test --filter observer-cursor',
    )
    expect(JSON.stringify(shell)).not.toContain('must not store command output')

    expect(
      normalizeCursorHook({ hook_event_name: 'sessionEnd' })?.normalizedType,
    ).toBe('session.ended')
    expect(
      normalizeCursorHook({ hook_event_name: 'preToolUse', tool_name: 'Read' })
        ?.normalizedType,
    ).toBe('file.read')
    expect(
      normalizeCursorHook({
        hook_event_name: 'postToolUse',
        tool_name: 'Write',
      })?.normalizedType,
    ).toBe('file.changed')
    expect(
      normalizeCursorHook({ hook_event_name: 'postToolUseFailure' })?.activity,
    ).toBe('failed')
    expect(
      normalizeCursorHook({ hook_event_name: 'afterShellExecution' })
        ?.normalizedType,
    ).toBe('command.completed')
    expect(
      normalizeCursorHook({
        hook_event_name: 'beforeReadFile',
        file_path: 'a.ts',
      })?.normalizedType,
    ).toBe('file.read')
    expect(
      normalizeCursorHook({ hook_event_name: 'beforeSubmitPrompt' })
        ?.normalizedType,
    ).toBe('prompt.submitted')
    expect(
      normalizeCursorHook({
        hook_event_name: 'afterAgentResponse',
        text: 'hidden answer',
      })?.normalizedType,
    ).toBe('activity.changed')
    expect(
      JSON.stringify(
        normalizeCursorHook({
          hook_event_name: 'afterAgentResponse',
          text: 'hidden answer',
        }),
      ),
    ).not.toContain('hidden answer')
    expect(normalizeCursorHook({ hook_event_name: 'stop' })?.activity).toBe(
      'completed',
    )
    expect(
      normalizeCursorHook({ hook_event_name: 'subagentStart' })?.normalizedType,
    ).toBe('subagent.started')
    expect(
      normalizeCursorHook({ hook_event_name: 'subagentStop' })?.normalizedType,
    ).toBe('subagent.stopped')
    expect(
      normalizeCursorHook({ hook_event_name: 'beforeTabFileRead' })?.surface,
    ).toBe('cursor-tab')
    expect(
      normalizeCursorHook({
        hook_event_name: 'sessionStart',
        client: 'cursor-cli',
      })?.surface,
    ).toBe('cursor-cli')
    expect(
      normalizeCursorHook({
        hook_event_name: 'sessionStart',
      })?.surface,
    ).toBe('unknown')
  })

  it('requires every design 13.2 event and fail-opens official extras', () => {
    expect([...CURSOR_REQUIRED_HOOK_EVENTS]).toEqual([
      'sessionStart',
      'sessionEnd',
      'preToolUse',
      'postToolUse',
      'postToolUseFailure',
      'beforeShellExecution',
      'afterShellExecution',
      'beforeReadFile',
      'afterFileEdit',
      'beforeSubmitPrompt',
      'afterAgentResponse',
      'stop',
      'subagentStart',
      'subagentStop',
      'beforeTabFileRead',
      'afterTabFileEdit',
    ])
    expect(CURSOR_REQUIRED_HOOK_EVENTS).toHaveLength(16)
    expect(
      missingCursorEvents({
        homeDir: '/tmp',
        repoDir: null,
        hooks: [],
        ourHooks: [],
        evidence: [],
        schemaVersion: null,
      }),
    ).toEqual([...CURSOR_REQUIRED_HOOK_EVENTS])

    const extra = normalizeCursorHook(readFixture('future-unknown.json'))
    expect(extra?.nativeEventType).toBe('beforeMCPExecution')
    expect(extra?.normalizedType).toBe('activity.changed')
    expect(JSON.stringify(extra)).not.toContain('do-not-store-mcp')
    expect(extra?.payload.future_field).toBeUndefined()
    expect(
      normalizeCursorHook({
        hook_event_name: 'afterAgentThought',
        thought: 'hidden chain of thought',
      })?.normalizedType,
    ).toBe('activity.changed')
    expect(
      JSON.stringify(
        normalizeCursorHook({
          hook_event_name: 'afterAgentThought',
          thought: 'hidden chain of thought',
        }),
      ),
    ).not.toContain('hidden chain of thought')
    expect(
      normalizeCursorHook({ hook_event_name: 'workspaceOpen' })?.normalizedType,
    ).toBe('session.started')
    expect(
      normalizeCursorHook({ hook_event_name: 'BrandNewCursorEvent' })
        ?.normalizedType,
    ).toBe('activity.changed')
  })

  it('does not claim Cloud Agent and drops malformed or traversing input', () => {
    const cloud = normalizeCursorHook({
      hook_event_name: 'sessionStart',
      surface: 'cursor-cloud',
      conversation_id: 'cloud-1',
    })
    expect(cloud?.surface).toBe('unknown')
    expect(cloud?.payload.origin).toBe('unsupported-cloud')
    expect(normalizeCursorHook(null)).toBeNull()
    expect(normalizeCursorHook('nope')).toBeNull()
    expect(normalizeCursorHook([])).toBeNull()
    const traversal = normalizeCursorHook({
      hook_event_name: 'afterFileEdit',
      file_path: '../etc/passwd',
    })
    expect(traversal?.payload.filePath).toBeUndefined()
    expect(traversal?.resource).toBeNull()
  })

  it('builds the same idempotency key for duplicates', () => {
    const payload = {
      hook_event_name: 'afterFileEdit',
      conversation_id: 'dup',
      occurredAt: '2026-08-18T00:00:00.000Z',
      file_path: 'src/a.ts',
    }
    const first = normalizeCursorHook(payload)
    const second = normalizeCursorHook(payload)
    expect(first?.idempotencyKey).toBe(second?.idempotencyKey)
  })
})

describe('cursor hook install', () => {
  it('merges user and repo hooks while keeping unknown fields', async () => {
    const home = createTemp()
    mkdirSync(join(home, '.cursor'), { recursive: true })
    writeFileSync(
      join(home, '.cursor', 'hooks.json'),
      `${JSON.stringify(
        {
          version: 1,
          experimentalFlag: true,
          hooks: {
            sessionStart: [{ command: '/tmp/user-hook' }],
          },
        },
        null,
        2,
      )}\n`,
    )
    const adapter = createCursorObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    expect(preview.requiresConfirm).toBe(true)
    expect(preview.changed).toBe(false)
    expect(preview.confirmationToken).toBeTruthy()
    expect(preview.preview).toContain('experimentalFlag')
    expect(preview.preview).toContain('/tmp/user-hook')
    expect(
      readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8'),
    ).not.toContain('sikumi-observer-cursor')

    const rejected = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: 'wrong-token',
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.applied).toBe(false)

    const applied = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(applied.applied).toBe(true)
    const written = JSON.parse(
      readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8'),
    ) as {
      version: number
      experimentalFlag: boolean
      hooks: Record<string, unknown[]>
    }
    expect(written.version).toBe(1)
    expect(written.experimentalFlag).toBe(true)
    for (const eventName of CURSOR_REQUIRED_HOOK_EVENTS) {
      expect(written.hooks[eventName]?.length).toBeGreaterThan(0)
    }
    expect(JSON.stringify(written.hooks.sessionStart)).toContain(
      '/tmp/user-hook',
    )
    expect(written.hooks.beforeMCPExecution).toBeUndefined()

    const health = await adapter.healthCheck({ homeDir: home })
    expect(health.status).toBe('needs_review')
    const observed = await adapter.healthCheck({
      homeDir: home,
      lastEventAt: '2026-08-18T00:00:00.000Z',
    })
    expect(observed.status).toBe('ready')

    const repo = createTemp()
    const repoPreview = await adapter.install({
      scope: 'repo',
      repoDir: repo,
      homeDir: home,
    })
    expect(repoPreview.requiresConfirm).toBe(true)
    const repoApplied = await adapter.install({
      scope: 'repo',
      repoDir: repo,
      homeDir: home,
      confirm: true,
      confirmationToken: repoPreview.confirmationToken!,
      planDigest: repoPreview.planDigest!,
    })
    expect(repoApplied.applied).toBe(true)
    expect(existsSync(join(repo, '.cursor', 'hooks.json'))).toBe(true)

    const uninstallPreview = await adapter.uninstall({ homeDir: home })
    const removed = await adapter.uninstall({
      homeDir: home,
      confirm: true,
      confirmationToken: uninstallPreview.confirmationToken!,
      planDigest: uninstallPreview.planDigest!,
    })
    expect(removed.applied).toBe(true)
    const after = JSON.parse(
      readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8'),
    ) as { experimentalFlag: boolean; hooks: { sessionStart: unknown[] } }
    expect(after.experimentalFlag).toBe(true)
    expect(JSON.stringify(after.hooks.sessionStart)).toContain('/tmp/user-hook')
    expect(JSON.stringify(after)).not.toContain('sikumi-observer-cursor')
  })

  it('marks unknown hooks.json version as needs_update and refuses symlink escape', async () => {
    const home = createTemp()
    mkdirSync(join(home, '.cursor'), { recursive: true })
    const adapter = createCursorObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    const current = JSON.parse(
      readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8'),
    ) as { version: number; hooks: Record<string, unknown> }
    writeFileSync(
      join(home, '.cursor', 'hooks.json'),
      `${JSON.stringify({ ...current, version: 9 }, null, 2)}\n`,
    )
    const health = await adapter.healthCheck({ homeDir: home })
    expect(health.status).toBe('needs_update')

    const refused = await adapter.install({ confirm: true })
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('実ユーザー')

    const linked = createTemp()
    const outside = createTemp()
    writeFileSync(join(outside, 'hooks.json'), '{}\n')
    symlinkSync(outside, join(linked, '.cursor'))
    const escaped = applyCursorHookMutation('install', {
      homeDir: linked,
      confirm: true,
      confirmationToken: 'unused',
    })
    expect(escaped.ok).toBe(false)
  })

  it('treats an injected HOME as real-user home unless the unpublished allow flag is set', async () => {
    const home = createTemp()
    const env = { HOME: home }
    const adapter = createCursorObserverAdapter()
    const preview = await adapter.install({ homeDir: home, env })
    const blocked = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
      env,
    })
    expect(blocked.ok).toBe(false)
    expect(existsSync(join(home, '.cursor', 'hooks.json'))).toBe(false)

    const allowed = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
      allowRealUserApply: true,
      env,
    })
    expect(allowed.applied).toBe(true)
  })

  it('rejects a stale confirmation token after the previewed file changes', async () => {
    const home = createTemp()
    mkdirSync(join(home, '.cursor'), { recursive: true })
    const adapter = createCursorObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    writeFileSync(join(home, '.cursor', 'hooks.json'), '{"changed":true}\n')
    const stale = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(stale.ok).toBe(false)
    expect(stale.message).toContain('表示した差分と現在の設定が一致しません')
    expect(readFileSync(join(home, '.cursor', 'hooks.json'), 'utf8')).toBe(
      '{"changed":true}\n',
    )
  })
})

describe('cursor hook CLI', () => {
  it('spools allowlisted events, stays fail-open, and is idempotent', async () => {
    const root = createTemp()
    const payload = readFixture('after-file-edit.json')
    const first = await runCursorObserverHook(['--root', root], {
      stdin: Readable.from([JSON.stringify(payload)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const second = await runCursorObserverHook(['--root', root], {
      stdin: Readable.from([JSON.stringify(payload)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const broken = await runCursorObserverHook(['--root', root], {
      stdin: Readable.from(['{nope']),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const oversized = await runCursorObserverHook(['--root', root], {
      stdin: Readable.from(['x'.repeat(20_000)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    expect([first, second, broken, oversized]).toEqual([0, 0, 0, 0])
    const files = readNdjson(observerInboxDir(root, 'cursor'))
    expect(files).toHaveLength(1)
    expect(files[0]).not.toContain('secret old')
  })
})

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
}

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'observer-cursor-'))
  tempDirectories.push(directory)
  return directory
}

function sink(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
}

function readNdjson(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }
  const name = readdirSync(directory).find((entry) => entry.endsWith('.ndjson'))
  if (!name) {
    return []
  }
  return readFileSync(join(directory, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
}
