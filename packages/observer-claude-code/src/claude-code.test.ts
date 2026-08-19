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
import { createClaudeCodeObserverAdapter } from './adapter.js'
import { runClaudeCodeObserverHook } from './cli.js'
import { missingClaudeCodeEvents } from './discovery.js'
import { CLAUDE_CODE_REQUIRED_HOOK_EVENTS, matcherAllows } from './events.js'
import { applyClaudeCodeHookMutation } from './install.js'
import { normalizeClaudeCodeHook } from './normalize.js'

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('normalizeClaudeCodeHook', () => {
  it('maps supported events and never keeps prompt or tool bodies', () => {
    const start = normalizeClaudeCodeHook(readFixture('session-start.json'))
    expect(start?.source).toBe('claude-code')
    expect(start?.normalizedType).toBe('session.started')
    expect(start?.surface).toBe('unknown')
    expect(JSON.stringify(start)).not.toContain('do not store this prompt')
    expect(JSON.stringify(start)).not.toContain('claude-transcript')

    const edit = normalizeClaudeCodeHook(readFixture('pre-tool-edit.json'))
    expect(edit?.normalizedType).toBe('file.changed')
    expect(edit?.payload.filePath).toBe('src/api/users.ts')
    expect(edit?.payload.matcher).toBe('Edit|Write')
    expect(JSON.stringify(edit)).not.toContain('secret body')

    const permission = normalizeClaudeCodeHook(readFixture('permission.json'))
    expect(permission?.normalizedType).toBe('permission.requested')
    expect(permission?.activity).toBe('waiting-for-user')

    const desktop = normalizeClaudeCodeHook(readFixture('desktop-surface.json'))
    expect(desktop?.surface).toBe('desktop-app')

    expect(normalizeClaudeCodeHook({ hook_event_name: 'TaskCreated' })?.normalizedType).toBe(
      'task.created',
    )
    expect(normalizeClaudeCodeHook({ hook_event_name: 'WorktreeCreate' })?.normalizedType).toBe(
      'worktree.created',
    )
    expect(normalizeClaudeCodeHook({ hook_event_name: 'FileChanged', file_path: 'a.ts' })?.normalizedType).toBe(
      'file.changed',
    )
    expect(normalizeClaudeCodeHook({ hook_event_name: 'CwdChanged' })?.normalizedType).toBe(
      'activity.changed',
    )
    expect(normalizeClaudeCodeHook({ hook_event_name: 'TeammateIdle' })?.normalizedType).toBe(
      'heartbeat',
    )
    expect(normalizeClaudeCodeHook({ hook_event_name: 'StopFailure' })?.normalizedType).toBe(
      'session.failed',
    )
    expect(normalizeClaudeCodeHook({ hook_event_name: 'PostToolUseFailure' })?.activity).toBe(
      'failed',
    )
    expect(normalizeClaudeCodeHook({ hook_event_name: 'Setup' })?.nativeEventType).toBe(
      'Setup',
    )
    expect(normalizeClaudeCodeHook({ hook_event_name: 'Setup' })?.normalizedType).toBe(
      'activity.changed',
    )
  })

  it('requires every design 15.2 event and treats Setup as unknown future', () => {
    expect([...CLAUDE_CODE_REQUIRED_HOOK_EVENTS]).toEqual([
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionRequest',
      'PermissionDenied',
      'Notification',
      'SubagentStart',
      'SubagentStop',
      'TaskCreated',
      'TaskCompleted',
      'Stop',
      'StopFailure',
      'TeammateIdle',
      'CwdChanged',
      'DirectoryAdded',
      'FileChanged',
      'WorktreeCreate',
      'WorktreeRemove',
      'PreCompact',
      'PostCompact',
    ])
    expect(CLAUDE_CODE_REQUIRED_HOOK_EVENTS).toHaveLength(23)
    expect(CLAUDE_CODE_REQUIRED_HOOK_EVENTS).not.toContain('Setup')
    expect(
      missingClaudeCodeEvents({
        settingsPaths: [],
        hooks: [],
        ourHooks: [],
        evidence: [],
      }),
    ).toEqual([...CLAUDE_CODE_REQUIRED_HOOK_EVENTS])
    expect(
      missingClaudeCodeEvents({
        settingsPaths: ['x'],
        hooks: [],
        ourHooks: [
          { path: 'x', eventName: 'SessionStart', matcher: null, ours: true },
        ],
        evidence: [],
      }),
    ).toEqual(CLAUDE_CODE_REQUIRED_HOOK_EVENTS.filter((event) => event !== 'SessionStart'))
  })

  it('does not guess desktop surface without evidence', () => {
    const event = normalizeClaudeCodeHook({
      hook_event_name: 'SessionStart',
      session_id: 's',
    })
    expect(event?.surface).toBe('unknown')
  })

  it('covers matchers and unknown future schema', () => {
    expect(matcherAllows('*', 'Bash')).toBe(true)
    expect(matcherAllows('Edit|Write', 'Write')).toBe(true)
    expect(matcherAllows('Bash', 'Edit')).toBe(false)
    const future = normalizeClaudeCodeHook({
      hook_event_name: 'BrandNewEvent',
      extra: { still: 'ok' },
      prompt: 'hidden',
    })
    expect(future?.normalizedType).toBe('activity.changed')
    expect(future?.nativeEventType).toBe('BrandNewEvent')
    expect(normalizeClaudeCodeHook(null)).toBeNull()
    expect(normalizeClaudeCodeHook('{')).toBeNull()
  })

  it('is idempotent and redacts bash command text', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'same',
      occurredAt: '2026-08-18T00:00:00.000Z',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
    }
    const first = normalizeClaudeCodeHook(payload)
    const second = normalizeClaudeCodeHook(payload)
    expect(first?.idempotencyKey).toBe(second?.idempotencyKey)
    expect(first?.payload.commandCategory).toBe('test')
    expect(JSON.stringify(first)).not.toContain('pnpm test')
  })
})

describe('claude code install', () => {
  it('merges into existing settings and keeps unknown fields', async () => {
    const home = createTemp()
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      `${JSON.stringify(
        {
          theme: 'dark',
          unknownFuture: { keep: true },
          hooks: {
            PreToolUse: [
              { matcher: 'Bash', hooks: [{ type: 'command', command: '/tmp/user-hook' }] },
            ],
          },
        },
        null,
        2,
      )}\n`,
    )
    const adapter = createClaudeCodeObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    expect(preview.requiresConfirm).toBe(true)
    expect(preview.changed).toBe(false)
    expect(preview.confirmationToken).toBeTruthy()
    expect(preview.preview).toContain('unknownFuture')
    expect(preview.preview).toContain('/tmp/user-hook')

    const rejected = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: 'wrong-token',
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.applied).toBe(false)

    expect(preview.confirmationToken).toBeTruthy()
    const applied = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(applied.applied).toBe(true)
    const written = JSON.parse(
      readFileSync(join(home, '.claude', 'settings.json'), 'utf8'),
    ) as {
      theme: string
      unknownFuture: { keep: boolean }
      hooks: Record<string, Array<{ matcher?: string }>>
    }
    expect(written.theme).toBe('dark')
    expect(written.unknownFuture.keep).toBe(true)
    expect(
      written.hooks.PreToolUse?.some((entry) => entry.matcher === '*'),
    ).toBe(true)
    for (const eventName of CLAUDE_CODE_REQUIRED_HOOK_EVENTS) {
      expect(written.hooks[eventName]?.length).toBeGreaterThan(0)
    }
    expect(written.hooks.Setup).toBeUndefined()

    const health = await adapter.healthCheck({ homeDir: home })
    expect(health.status).toBe('needs_review')
    const observed = await adapter.healthCheck({
      homeDir: home,
      lastEventAt: '2026-08-18T00:00:00.000Z',
    })
    expect(observed.status).toBe('ready')

    const uninstallPreview = await adapter.uninstall({ homeDir: home })
    expect(uninstallPreview.confirmationToken).toBeTruthy()
    const removed = await adapter.uninstall({
      homeDir: home,
      confirm: true,
      confirmationToken: uninstallPreview.confirmationToken!,
      planDigest: uninstallPreview.planDigest!,
    })
    expect(removed.applied).toBe(true)
    const after = JSON.parse(
      readFileSync(join(home, '.claude', 'settings.json'), 'utf8'),
    ) as { theme: string; hooks: { PreToolUse: unknown[] } }
    expect(after.theme).toBe('dark')
    expect(JSON.stringify(after.hooks.PreToolUse)).toContain('/tmp/user-hook')
    expect(JSON.stringify(after)).not.toContain('sikumi-observer-claude-code')
  })

  it('refuses real-user apply and symlink escape', async () => {
    const adapter = createClaudeCodeObserverAdapter()
    const refused = await adapter.install({ confirm: true })
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('実ユーザー')

    const home = createTemp()
    const outside = createTemp()
    writeFileSync(join(outside, 'settings.json'), '{}\n')
    mkdirSync(home, { recursive: true })
    symlinkSync(outside, join(home, '.claude'))
    const escaped = applyClaudeCodeHookMutation('install', {
      homeDir: home,
      confirm: true,
      confirmationToken: 'unused',
    })
    expect(escaped.ok).toBe(false)
  })

  it('treats an injected HOME as real-user home unless the unpublished allow flag is set', async () => {
    const home = createTemp()
    const env = { HOME: home }
    const adapter = createClaudeCodeObserverAdapter()
    const preview = await adapter.install({ homeDir: home, env })
    expect(preview.confirmationToken).toBeTruthy()
    const blocked = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
      env,
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.applied).toBe(false)
    expect(existsSync(join(home, '.claude', 'settings.json'))).toBe(false)

    const allowed = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
      allowRealUserApply: true,
      env,
    })
    expect(allowed.applied).toBe(true)
    const written = JSON.parse(
      readFileSync(join(home, '.claude', 'settings.json'), 'utf8'),
    ) as { hooks: Record<string, unknown[]> }
    for (const eventName of CLAUDE_CODE_REQUIRED_HOOK_EVENTS) {
      expect(written.hooks[eventName]?.length).toBeGreaterThan(0)
    }
  })
})

describe('claude code hook CLI', () => {
  it('spools events, ignores malformed input, and stays fail-open', async () => {
    const root = createTemp()
    const payload = readFixture('pre-tool-edit.json')
    const first = await runClaudeCodeObserverHook(['--root', root], {
      stdin: Readable.from([JSON.stringify(payload)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const second = await runClaudeCodeObserverHook(['--root', root], {
      stdin: Readable.from([JSON.stringify(payload)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const broken = await runClaudeCodeObserverHook(['--root', root], {
      stdin: Readable.from(['{nope']),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    expect([first, second, broken]).toEqual([0, 0, 0])
    const files = readNdjson(observerInboxDir(root, 'claude-code'))
    expect(files).toHaveLength(1)
    expect(files[0]).not.toContain('secret body')
  })
})

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
}

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'observer-claude-'))
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
