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
import { createCodexObserverAdapter } from './adapter.js'
import { runCodexObserverHook } from './cli.js'
import { CODEX_HOOK_EVENTS } from './events.js'
import {
  applyCodexHookMutation,
  resolveCodexHookCommandPath,
} from './install.js'
import { normalizeCodexHook } from './normalize.js'

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const sessionStart = readFixture('session-start.json')
const preToolEdit = readFixture('pre-tool-edit.json')
const preToolBash = readFixture('pre-tool-bash.json')
const futureUnknown = readFixture('future-unknown.json')

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('normalizeCodexHook', () => {
  it('maps current supported events and redacts prompt, transcript, and patch', () => {
    const start = normalizeCodexHook(sessionStart)
    expect(start?.normalizedType).toBe('session.started')
    expect(start?.externalSessionId).toBe('sess-codex-1')
    expect(start?.surface).toBe('unknown')
    expect(JSON.stringify(start)).not.toContain('do not store this prompt')
    expect(JSON.stringify(start)).not.toContain('transcript.jsonl')

    const edit = normalizeCodexHook(preToolEdit)
    expect(edit?.normalizedType).toBe('file.changed')
    expect(edit?.payload.filePath).toBe('src/auth/session.ts')
    expect(edit?.externalTurnId).toBe('turn-3')
    expect(JSON.stringify(edit)).not.toContain('*** Update File')
    expect(JSON.stringify(edit)).not.toContain('-old')

    const bash = normalizeCodexHook(preToolBash)
    expect(bash?.normalizedType).toBe('command.started')
    expect(bash?.payload.commandCategory).toBe('test')
    expect(JSON.stringify(bash)).not.toContain(
      'pnpm test --filter observer-codex',
    )

    expect(
      normalizeCodexHook({ hook_event_name: 'PermissionRequest' })
        ?.normalizedType,
    ).toBe('permission.requested')
    expect(
      normalizeCodexHook({ hook_event_name: 'SubagentStart' })?.normalizedType,
    ).toBe('subagent.started')
    expect(
      normalizeCodexHook({ hook_event_name: 'SubagentStop' })?.normalizedType,
    ).toBe('subagent.stopped')
    expect(normalizeCodexHook({ hook_event_name: 'Stop' })?.activity).toBe(
      'completed',
    )
    expect(
      normalizeCodexHook({ hook_event_name: 'PreCompact' })?.activity,
    ).toBe('reviewing')
    expect(
      normalizeCodexHook({ hook_event_name: 'PostCompact' })?.normalizedType,
    ).toBe('activity.changed')
    expect(
      normalizeCodexHook({ hook_event_name: 'SessionEnd' })?.normalizedType,
    ).toBe('session.ended')
  })

  it('keeps unknown future events instead of throwing', () => {
    const event = normalizeCodexHook(futureUnknown)
    expect(event?.nativeEventType).toBe('Future hypothetical Event')
    expect(event?.normalizedType).toBe('activity.changed')
    expect(event?.payload.future_field).toBeUndefined()
  })

  it('drops malformed input and path traversal', () => {
    expect(normalizeCodexHook(null)).toBeNull()
    expect(normalizeCodexHook('nope')).toBeNull()
    expect(normalizeCodexHook([])).toBeNull()
    const traversal = normalizeCodexHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '../etc/passwd' },
    })
    expect(traversal?.payload.filePath).toBeUndefined()
    expect(traversal?.resource).toBeNull()
  })

  it('builds the same idempotency key for duplicates', () => {
    const payload = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'dup',
      occurredAt: '2026-08-18T00:00:00.000Z',
      prompt: 'hidden once',
    }
    const first = normalizeCodexHook(payload)
    const second = normalizeCodexHook(payload)
    expect(first?.idempotencyKey).toBe(second?.idempotencyKey)
  })
})

describe('codex hook install', () => {
  it('previews a merge that keeps unknown fields and requires confirm', async () => {
    const home = createTemp()
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(
      join(home, '.codex', 'hooks.json'),
      `${JSON.stringify(
        {
          experimentalFlag: true,
          hooks: {
            SessionStart: [
              { hooks: [{ type: 'command', command: '/tmp/user-hook' }] },
            ],
          },
        },
        null,
        2,
      )}\n`,
    )
    const adapter = createCodexObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    expect(preview.changed).toBe(false)
    expect(preview.requiresConfirm).toBe(true)
    expect(preview.confirmationToken).toBeTruthy()
    expect(preview.planDigest).toBeTruthy()
    expect(preview.targetRoot).toBe(home)
    expect(preview.preview).toContain('experimentalFlag')
    expect(preview.preview).toContain('/tmp/user-hook')
    expect(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).toContain(
      'user-hook',
    )
    expect(
      readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'),
    ).not.toContain('sikumi-observer-codex')
  })

  it('applies only to a sandbox and can roll back via uninstall', async () => {
    const home = createTemp()
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(
      join(home, '.codex', 'hooks.json'),
      `${JSON.stringify(
        {
          keepMe: 'yes',
          hooks: {
            SessionStart: [
              { hooks: [{ type: 'command', command: '/tmp/user-hook' }] },
            ],
          },
        },
        null,
        2,
      )}\n`,
    )
    const adapter = createCodexObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    const rejected = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: 'wrong-token',
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.applied).toBe(false)
    expect(
      readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'),
    ).not.toContain('sikumi-observer-codex')
    expect(preview.confirmationToken).toBeTruthy()
    const applied = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(applied.applied).toBe(true)
    const written = JSON.parse(
      readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'),
    ) as { keepMe: string; hooks: Record<string, unknown[]> }
    expect(written.keepMe).toBe('yes')
    for (const eventName of CODEX_HOOK_EVENTS) {
      expect(written.hooks[eventName]?.length).toBeGreaterThan(0)
    }
    expect(JSON.stringify(written.hooks.SessionStart)).toContain(
      '/tmp/user-hook',
    )

    const health = await adapter.healthCheck({ homeDir: home })
    expect(health.status).toBe('needs_review')

    writeFileSync(
      join(home, '.codex', 'hooks-trust.json'),
      `${JSON.stringify({
        reviewed: [{ command: resolveCodexHookCommandPath() }],
      })}\n`,
    )
    const stillReview = await adapter.healthCheck({ homeDir: home })
    expect(stillReview.status).toBe('needs_review')
    const observed = await adapter.healthCheck({
      homeDir: home,
      lastEventAt: '2026-08-18T00:00:00.000Z',
    })
    expect(observed.status).toBe('ready')
    expect(observed.lastEventAt).toBe('2026-08-18T00:00:00.000Z')

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
      readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'),
    ) as { keepMe: string; hooks: { SessionStart: unknown[] } }
    expect(after.keepMe).toBe('yes')
    expect(JSON.stringify(after.hooks.SessionStart)).toContain('/tmp/user-hook')
    expect(JSON.stringify(after)).not.toContain('sikumi-observer-codex')
  })

  it('refuses real-user apply and symlink escape', async () => {
    const adapter = createCodexObserverAdapter()
    const refused = await adapter.install({ confirm: true })
    expect(refused.ok).toBe(false)
    expect(refused.applied).toBe(false)
    expect(refused.message).toContain('実ユーザー')

    const home = createTemp()
    const outside = createTemp()
    mkdirSync(join(home, '.codex-link-src'), { recursive: true })
    writeFileSync(join(outside, 'hooks.json'), '{}\n')
    symlinkSync(outside, join(home, '.codex'))
    const escaped = applyCodexHookMutation('install', {
      homeDir: home,
      confirm: true,
      confirmationToken: 'unused',
    })
    expect(escaped.ok).toBe(false)
  })

  it('treats an injected HOME as real-user home unless the unpublished allow flag is set', async () => {
    const home = createTemp()
    const env = { HOME: home }
    const adapter = createCodexObserverAdapter()
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
    expect(existsSync(join(home, '.codex', 'hooks.json'))).toBe(false)

    const allowed = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
      allowRealUserApply: true,
      env,
    })
    expect(allowed.applied).toBe(true)
    expect(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).toContain(
      'sikumi-observer-codex',
    )
  })

  it('installs through a staged command when the source path contains *', async () => {
    const sourceRoot = join(createTemp(), '*開発', 'bin')
    mkdirSync(sourceRoot, { recursive: true })
    const sourcePath = join(sourceRoot, 'sikumi-observer-codex.mjs')
    writeFileSync(
      sourcePath,
      `${readFileSync(resolveCodexHookCommandPath(), 'utf8')}\n`,
    )
    const home = createTemp()
    const adapter = createCodexObserverAdapter()
    const preview = await adapter.install({
      homeDir: home,
      hookCommandSourcePath: sourcePath,
    })
    expect(preview.ok).toBe(true)
    expect(preview.preview).toContain(
      join(
        home,
        '.shikumi-local',
        'observer',
        'bin',
        'sikumi-observer-codex.mjs',
      ),
    )
    expect(preview.preview).not.toContain(
      'Hookコマンドの絶対pathが安全ではありません',
    )
    const applied = await adapter.install({
      homeDir: home,
      hookCommandSourcePath: sourcePath,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(applied.applied).toBe(true)
    const written = readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')
    expect(written).toContain(
      join(
        home,
        '.shikumi-local',
        'observer',
        'bin',
        'sikumi-observer-codex.mjs',
      ),
    )
    expect(written).not.toContain('*開発')
    const launcher = join(
      home,
      '.shikumi-local',
      'observer',
      'bin',
      'sikumi-observer-codex.mjs',
    )
    expect(existsSync(launcher)).toBe(true)
    expect(readFileSync(launcher, 'utf8')).toContain('*開発')
  })

  it('rejects a stale confirmation token after the previewed file changes', async () => {
    const home = createTemp()
    mkdirSync(join(home, '.codex'), { recursive: true })
    const adapter = createCodexObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    expect(preview.confirmationToken).toBeTruthy()
    writeFileSync(join(home, '.codex', 'hooks.json'), '{"changed":true}\n')
    const stale = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(stale.ok).toBe(false)
    expect(stale.applied).toBe(false)
    expect(stale.message).toContain('表示した差分と現在の設定が一致しません')
    expect(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).toBe(
      '{"changed":true}\n',
    )
  })
})

describe('codex hook CLI', () => {
  it('spools allowlisted events, stays fail-open, and is idempotent', async () => {
    const root = createTemp()
    const first = await runCodexObserverHook(['--root', root], {
      stdin: Readable.from([JSON.stringify(preToolEdit)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const second = await runCodexObserverHook(['--root', root], {
      stdin: Readable.from([JSON.stringify(preToolEdit)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const broken = await runCodexObserverHook(['--root', root], {
      stdin: Readable.from(['{not-json']),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    expect(first).toBe(0)
    expect(second).toBe(0)
    expect(broken).toBe(0)
    const files = readNdjson(observerInboxDir(root, 'codex'))
    expect(files).toHaveLength(1)
    expect(files[0]).not.toContain('*** Update File')
  })
})

describe('plugin trust', () => {
  it('does not treat user-writable plugin manifest fields as ready', async () => {
    const home = createTemp()
    const plugin = join(home, '.codex', 'plugins', 'sikumi')
    mkdirSync(join(plugin, '.codex-plugin'), { recursive: true })
    const command = resolveCodexHookCommandPath()
    const hooks: Record<string, unknown> = {}
    for (const eventName of CODEX_HOOK_EVENTS) {
      hooks[eventName] = [{ hooks: [{ type: 'command', command }] }]
    }
    writeFileSync(join(plugin, 'hooks.json'), `${JSON.stringify({ hooks })}\n`)
    writeFileSync(
      join(plugin, '.codex-plugin', 'plugin.json'),
      `${JSON.stringify({ managed: true, trusted: true, hooks })}\n`,
    )
    const adapter = createCodexObserverAdapter()
    const health = await adapter.healthCheck({ homeDir: home })
    expect(health.status).toBe('needs_review')
    expect(existsSync(command)).toBe(true)
    const observed = await adapter.healthCheck({
      homeDir: home,
      lastEventAt: '2026-08-18T01:00:00.000Z',
    })
    expect(observed.status).toBe('ready')
  })
})

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
}

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'observer-codex-'))
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
