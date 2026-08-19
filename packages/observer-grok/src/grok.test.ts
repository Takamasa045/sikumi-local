import { spawnSync } from 'node:child_process'
import {
  chmodSync,
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
import { parseSemver } from '@sikumi-local/observer-core'
import { createGrokObserverAdapter } from './adapter.js'
import { runGrokObserverHook } from './cli.js'
import { discoverGrokHooks, missingGrokEvents } from './discovery.js'
import {
  GROK_COMMAND_PLACEHOLDER,
  GROK_PLUGIN_ID,
  GROK_REQUIRED_HOOK_EVENTS,
  GROK_SUPPORTED_VERSION_RANGE,
} from './events.js'
import { applyGrokHookMutation, resolveGrokHookCommandPath } from './install.js'
import { normalizeGrokEvent } from './normalize.js'
import {
  mergeGrokToml,
  parseGrokHooksToml,
  renderGrokHooksJson,
  renderGrokHooksToml,
  renderGrokPluginManifest,
  resolveGrokPluginSourceDir,
  stripSikumiToml,
} from './plugin.js'
import { isDroppedGrokStreamEvent } from './stream.js'
import { inspectGrokVersion } from './version.js'

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('normalizeGrokEvent', () => {
  it('maps hook events and never keeps prompt, thought, or tool bodies', () => {
    const start = normalizeGrokEvent(readFixture('session-start.json'))
    expect(start?.source).toBe('grok-build')
    expect(start?.normalizedType).toBe('session.started')
    expect(start?.ingestionMethod).toBe('hook')
    expect(JSON.stringify(start)).not.toContain('do not store this prompt')
    expect(JSON.stringify(start)).not.toContain('hidden transcript')

    const edit = normalizeGrokEvent(readFixture('pre-tool-edit.json'))
    expect(edit?.normalizedType).toBe('file.changed')
    expect(edit?.payload.filePath).toBe('src/schema/users.ts')
    expect(JSON.stringify(edit)).not.toContain('secret body')

    expect(normalizeGrokEvent({ hook_event_name: 'SessionEnd' })?.normalizedType).toBe(
      'session.ended',
    )
    expect(normalizeGrokEvent({ hook_event_name: 'SubagentStart' })?.normalizedType).toBe(
      'subagent.started',
    )
    expect(normalizeGrokEvent({ hook_event_name: 'WorktreeCreate' })?.normalizedType).toBe(
      'worktree.created',
    )
    expect(normalizeGrokEvent({ hook_event_name: 'PermissionRequest' })?.activity).toBe(
      'waiting-for-user',
    )
    expect(normalizeGrokEvent({ hook_event_name: 'PostToolUseFailure' })?.activity).toBe(
      'failed',
    )
    expect(normalizeGrokEvent({ hook_event_name: 'Stop' })?.activity).toBe('completed')
  })

  it('parses streaming-json metadata and drops text/thought/full response', () => {
    expect(isDroppedGrokStreamEvent(readFixture('stream-thought.json'))).toBe(true)
    expect(normalizeGrokEvent(readFixture('stream-thought.json'))).toBeNull()
    expect(
      normalizeGrokEvent({
        type: 'text',
        text: 'full assistant response that must vanish',
      }),
    ).toBeNull()

    const tool = normalizeGrokEvent(readFixture('stream-tool.json'))
    expect(tool?.ingestionMethod).toBe('stream-json')
    expect(tool?.normalizedType).toBe('file.changed')
    expect(tool?.payload.filePath).toBe('src/api/users.ts')
    expect(JSON.stringify(tool)).not.toContain('full file must persist')

    expect(
      normalizeGrokEvent({
        type: 'permission_request',
        session_id: 's',
      }),
    ).toBeNull()
    const failed = normalizeGrokEvent({
      type: 'result',
      subtype: 'error',
      session_id: 's',
    })
    expect(failed?.activity).toBe('failed')
  })

  it('drops the verified streaming-json shape and keeps tool/session/result metadata only', () => {
    const events = readFixture('stream-real-shape.json')
    expect(Array.isArray(events)).toBe(true)
    const kept = (events as unknown[]).map((event) => normalizeGrokEvent(event))
    const serialized = JSON.stringify(kept)
    expect(serialized).not.toContain('secret command catalog must vanish')
    expect(serialized).not.toContain('full assistant response that must vanish')
    expect(serialized).not.toContain('hidden chain of thought')
    expect(serialized).not.toContain('thought delta secret')
    expect(serialized).not.toContain('hidden reasoning must vanish')
    expect(serialized).not.toContain('agent message full text must vanish')
    expect(serialized).not.toContain('hidden thought chunk must vanish')
    expect(serialized).not.toContain('user prompt must vanish')
    expect(serialized).not.toContain('full file must not persist')
    expect(
      isDroppedGrokStreamEvent({
        type: 'available_commands',
        session_id: 'sess-real-stream',
        commands: [{ name: 'help' }],
      }),
    ).toBe(true)
    expect(
      kept.filter((event) => event !== null).map((event) => event.nativeEventType),
    ).toEqual(['session_info_update', 'tool_call', 'result'])
  })

  it('requires the design 14.2 event set and fail-opens unknown future', () => {
    expect(GROK_REQUIRED_HOOK_EVENTS).toContain('PreToolUse')
    expect(GROK_REQUIRED_HOOK_EVENTS).toContain('SessionStart')
    expect(GROK_REQUIRED_HOOK_EVENTS).toContain('WorktreeCreate')
    expect(
      missingGrokEvents({
        homeDir: '/tmp',
        repoDir: null,
        hooks: [],
        ourHooks: [],
        pluginPaths: [],
        evidence: [],
      }),
    ).toEqual([...GROK_REQUIRED_HOOK_EVENTS])
    const future = normalizeGrokEvent({
      hook_event_name: 'BrandNewGrokEvent',
      prompt: 'hidden',
    })
    expect(future?.nativeEventType).toBe('BrandNewGrokEvent')
    expect(future?.normalizedType).toBe('activity.changed')
    expect(normalizeGrokEvent(null)).toBeNull()
    expect(normalizeGrokEvent('nope')).toBeNull()
    const traversal = normalizeGrokEvent({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '../etc/passwd' },
    })
    expect(traversal?.payload.filePath).toBeUndefined()
  })

  it('is idempotent and redacts command text', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'same',
      occurredAt: '2026-08-18T00:00:00.000Z',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
    }
    const first = normalizeGrokEvent(payload)
    const second = normalizeGrokEvent(payload)
    expect(first?.idempotencyKey).toBe(second?.idempotencyKey)
    expect(first?.payload.commandCategory).toBe('test')
    expect(JSON.stringify(first)).not.toContain('pnpm test')
  })
})

describe('official grok hook schema', () => {
  it('renders nested TOML with event tables, type=command, and matcher only on tool events', () => {
    const rendered = renderGrokHooksToml('/abs/sikumi-observer-grok.mjs')
    expect(rendered).toContain('[[hooks.PreToolUse]]')
    expect(rendered).toContain('[[hooks.PreToolUse.hooks]]')
    expect(rendered).toContain('type = "command"')
    expect(rendered).toContain('command = "/abs/sikumi-observer-grok.mjs"')
    expect(rendered).toContain('matcher = "*"')
    expect(rendered).not.toContain('[[hooks.Event]]')
    expect(rendered).not.toContain('event = "')
    expect(rendered).not.toContain('trustRequired')
    const parsed = parseGrokHooksToml(rendered)
    expect(parsed.map((hook) => hook.eventName)).toEqual([...GROK_REQUIRED_HOOK_EVENTS])
    expect(parsed.find((hook) => hook.eventName === 'PreToolUse')?.matcher).toBe('*')
    expect(parsed.find((hook) => hook.eventName === 'SessionStart')?.matcher).toBeNull()
    expect(parsed.every((hook) => hook.type === 'command')).toBe(true)
  })

  it('keeps plugin source artifacts on the official JSON hooks component schema', () => {
    const pluginDir = resolveGrokPluginSourceDir()
    const manifest = JSON.parse(
      readFileSync(join(pluginDir, 'plugin.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(manifest.trustRequired).toBeUndefined()
    expect(manifest.trusted).toBeUndefined()
    expect(existsSync(join(pluginDir, 'hooks.toml'))).toBe(false)
    expect(JSON.parse(readFileSync(join(pluginDir, 'hooks', 'hooks.json'), 'utf8'))).toEqual(
      JSON.parse(renderGrokHooksJson(GROK_COMMAND_PLACEHOLDER)),
    )
    expect(JSON.parse(renderGrokPluginManifest()).trustRequired).toBeUndefined()
  })
})

describe('grok install and health', () => {
  it('previews plugin + hook plans, keeps unknown toml, and needs a real event for ready', async () => {
    const home = createTemp()
    mkdirSync(join(home, '.grok'), { recursive: true })
    const existing = [
      'keep_me = true',
      '',
      '[[hooks.PreToolUse]]',
      'matcher = "Bash"',
      '  [[hooks.PreToolUse.hooks]]',
      '  type = "command"',
      '  command = "/tmp/user-hook"',
      '',
    ].join('\n')
    writeFileSync(join(home, '.grok', 'config.toml'), existing)
    const adapter = createGrokObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    expect(preview.requiresConfirm).toBe(true)
    expect(preview.changed).toBe(false)
    expect(preview.preview).toContain('keep_me = true')
    expect(preview.preview).toContain('/tmp/user-hook')
    expect(preview.preview).toContain('[[hooks.PreToolUse.hooks]]')
    expect(preview.preview).toContain(GROK_PLUGIN_ID)
    expect(preview.preview).toContain('hooks/hooks.json')
    expect(readFileSync(join(home, '.grok', 'config.toml'), 'utf8')).toBe(existing)

    const rejected = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: 'wrong',
    })
    expect(rejected.ok).toBe(false)

    const applied = await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(applied.applied).toBe(true)
    const toml = readFileSync(join(home, '.grok', 'config.toml'), 'utf8')
    expect(toml.startsWith(existing)).toBe(true)
    expect(toml).toContain('/tmp/user-hook')
    expect(toml).toContain('sikumi-observer-grok')
    expect(toml).toContain('[[hooks.SessionStart]]')
    expect(toml).toContain('  [[hooks.SessionStart.hooks]]')
    expect(toml).not.toContain('[[hooks.Event]]')
    expect(
      existsSync(join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'plugin.json')),
    ).toBe(true)
    expect(
      existsSync(join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'hooks', 'hooks.json')),
    ).toBe(true)
    expect(
      existsSync(join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'hooks.toml')),
    ).toBe(false)
    const pluginHooks = JSON.parse(
      readFileSync(
        join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'hooks', 'hooks.json'),
        'utf8',
      ),
    ) as { hooks: Record<string, unknown> }
    expect(Object.keys(pluginHooks.hooks)).toEqual([...GROK_REQUIRED_HOOK_EVENTS])

    const discovered = discoverGrokHooks({
      homeDir: home,
      hookCommandPath: resolveGrokHookCommandPath(),
    })
    expect(missingGrokEvents(discovered)).toEqual([])
    expect(discovered.evidence.join(' ')).not.toMatch(/hooks-trust|plugins-trust/)

    const health = await adapter.healthCheck({ homeDir: home, env: { PATH: home } })
    expect(health.status).toBe('needs_review')
    expect(health.warnings.join(' ')).toMatch(/ready|実event/)
    expect(health.warnings.join(' ')).not.toMatch(/hooks-trust|plugins-trust/)

    const observed = await adapter.healthCheck({
      homeDir: home,
      lastEventAt: '2026-08-18T00:00:00.000Z',
      env: { PATH: home },
    })
    expect(observed.status).toBe('ready')

    const uninstallPreview = await adapter.uninstall({ homeDir: home })
    const removed = await adapter.uninstall({
      homeDir: home,
      confirm: true,
      confirmationToken: uninstallPreview.confirmationToken!,
      planDigest: uninstallPreview.planDigest!,
    })
    expect(removed.applied).toBe(true)
    const after = readFileSync(join(home, '.grok', 'config.toml'), 'utf8')
    expect(after).toBe(existing)
    expect(after).toContain('keep_me = true')
    expect(after).toContain('/tmp/user-hook')
    expect(after).not.toContain('sikumi-observer-grok')
    expect(
      existsSync(join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'plugin.json')),
    ).toBe(false)
    expect(
      existsSync(join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'hooks', 'hooks.json')),
    ).toBe(false)
  })

  it('migrates leftover unofficial Sikumi tables and plugin hooks.toml without rewriting user nested hooks', () => {
    const home = createTemp()
    mkdirSync(join(home, '.grok', 'plugins', GROK_PLUGIN_ID), { recursive: true })
    const command = resolveGrokHookCommandPath()
    const existing = [
      '# keep this comment',
      'unknown_key = "stay"',
      '',
      '[[hooks.PreToolUse]]',
      'matcher = "Bash"',
      '  [[hooks.PreToolUse.hooks]]',
      '  type = "command"',
      '  command = "/tmp/user-hook"',
      '',
      '[[hooks.Event]]',
      'event = "SessionStart"',
      `command = "${command}"`,
      '',
    ].join('\n')
    writeFileSync(join(home, '.grok', 'config.toml'), existing)
    writeFileSync(
      join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'hooks.toml'),
      '[[hooks.Event]]\nevent = "Stop"\n',
    )
    const merged = mergeGrokToml(existing, command)
    expect(merged).toContain('# keep this comment')
    expect(merged).toContain('unknown_key = "stay"')
    expect(merged).toContain('command = "/tmp/user-hook"')
    expect(merged).toContain('[[hooks.SessionStart]]')
    expect(merged.match(/\[\[hooks\.Event\]\]/g) ?? []).toEqual([])
    const stripped = stripSikumiToml(merged, command)
    expect(stripped).toContain('# keep this comment')
    expect(stripped).toContain('command = "/tmp/user-hook"')
    expect(stripped).not.toContain(command)

    const preview = applyGrokHookMutation('install', { homeDir: home })
    const applied = applyGrokHookMutation('install', {
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(applied.applied).toBe(true)
    expect(
      existsSync(join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'hooks.toml')),
    ).toBe(false)
    expect(
      existsSync(join(home, '.grok', 'plugins', GROK_PLUGIN_ID, 'hooks', 'hooks.json')),
    ).toBe(true)
  })

  it('extracts verified grok 1.0.5 and treats other versions as unverified', async () => {
    expect(GROK_SUPPORTED_VERSION_RANGE).toEqual({
      min: '1.0.5',
      max: '1.0.5',
      label: '1.0.5',
    })
    expect(parseSemver('grok 1.0.5 (5115b46bc909) [stable]')).toBe('1.0.5')
    const home = createTemp()
    const supportedBin = createTemp()
    writeFileSync(
      join(supportedBin, 'grok'),
      '#!/usr/bin/env node\nconsole.log("grok 1.0.5 (5115b46bc909) [stable]")\n',
    )
    chmodSync(join(supportedBin, 'grok'), 0o755)
    const supported = await inspectGrokVersion({
      PATH: supportedBin,
      HOME: home,
    })
    expect(supported.version).toBe('1.0.5')
    expect(supported.classification).toBe('supported')
    expect(supported.supportedRange).toBe('1.0.5')

    const otherBin = createTemp()
    writeFileSync(join(otherBin, 'grok'), '#!/usr/bin/env node\nconsole.log("1.0.0")\n')
    chmodSync(join(otherBin, 'grok'), 0o755)
    const other = await inspectGrokVersion({ PATH: otherBin, HOME: home })
    expect(other.classification).toBe('needs_update')
  })

  it('marks unverified versions as needs_update and keeps git fallback messaging', async () => {
    const home = createTemp()
    const bin = createTemp()
    writeFileSync(join(bin, 'grok'), '#!/usr/bin/env node\nconsole.log("2.4.0")\n')
    chmodSync(join(bin, 'grok'), 0o755)
    const adapter = createGrokObserverAdapter()
    const preview = await adapter.install({ homeDir: home })
    await adapter.install({
      homeDir: home,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    const health = await adapter.healthCheck({
      homeDir: home,
      env: { PATH: bin, HOME: home },
    })
    expect(health.status).toBe('needs_update')
    expect(health.detectedVersion).toBe('2.4.0')
    expect(health.supportedRange).toBe('1.0.5')
    expect(health.warnings.join(' ')).toContain('Git観測')
  })

  it('refuses real-user apply, symlink escape, and stale digest', async () => {
    const adapter = createGrokObserverAdapter()
    const refused = await adapter.install({ confirm: true })
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('実ユーザー')

    const home = createTemp()
    const outside = createTemp()
    writeFileSync(join(outside, 'config.toml'), 'keep=1\n')
    symlinkSync(outside, join(home, '.grok'))
    const escaped = applyGrokHookMutation('install', {
      homeDir: home,
      confirm: true,
      confirmationToken: 'unused',
    })
    expect(escaped.ok).toBe(false)

    const sandbox = createTemp()
    mkdirSync(join(sandbox, '.grok'), { recursive: true })
    const preview = await adapter.install({ homeDir: sandbox })
    writeFileSync(join(sandbox, '.grok', 'config.toml'), 'changed = true\n')
    const stale = await adapter.install({
      homeDir: sandbox,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(stale.ok).toBe(false)
    expect(stale.message).toContain('表示した差分と現在の設定が一致しません')
  })

  it('installs repo-scoped JSON hooks and keeps unknown files while removing only Sikumi leftovers', async () => {
    const repo = createTemp()
    mkdirSync(join(repo, '.grok', 'hooks'), { recursive: true })
    writeFileSync(join(repo, '.grok', 'hooks', 'version.json'), '{"version":"keep"}\n')
    writeFileSync(join(repo, '.grok', 'hooks', 'unknown-custom.json'), '{"keep":true}\n')
    writeFileSync(
      join(repo, '.grok', 'hooks', 'sikumi-observer.toml'),
      '[[hooks.Event]]\nevent = "Stop"\n',
    )
    const adapter = createGrokObserverAdapter()
    const preview = await adapter.install({ scope: 'repo', repoDir: repo })
    const applied = await adapter.install({
      scope: 'repo',
      repoDir: repo,
      confirm: true,
      confirmationToken: preview.confirmationToken!,
      planDigest: preview.planDigest!,
    })
    expect(applied.applied).toBe(true)
    expect(existsSync(join(repo, '.grok', 'hooks', 'sikumi-observer.json'))).toBe(true)
    expect(existsSync(join(repo, '.grok', 'hooks', 'sikumi-observer.toml'))).toBe(false)
    expect(existsSync(join(repo, '.grok', 'managed_config.toml'))).toBe(false)
    expect(readFileSync(join(repo, '.grok', 'hooks', 'version.json'), 'utf8')).toBe(
      '{"version":"keep"}\n',
    )
    expect(readFileSync(join(repo, '.grok', 'hooks', 'unknown-custom.json'), 'utf8')).toBe(
      '{"keep":true}\n',
    )
    const discovered = discoverGrokHooks({
      homeDir: createTemp(),
      repoDir: repo,
      hookCommandPath: resolveGrokHookCommandPath(),
    })
    expect(missingGrokEvents(discovered)).toEqual([])
  })
})

describe('grok hook CLI', () => {
  it('spools hooks, drops stream thoughts, and stays fail-open', async () => {
    const root = createTemp()
    const hook = readFixture('pre-tool-edit.json')
    const first = await runGrokObserverHook(['--root', root], {
      stdin: Readable.from([JSON.stringify(hook)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const second = await runGrokObserverHook(['--root', root], {
      stdin: Readable.from([JSON.stringify(hook)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const realShape = readFixture('stream-real-shape.json') as unknown[]
    const stream = await runGrokObserverHook(
      ['--root', root, '--output-format', 'streaming-json'],
      {
        stdin: Readable.from([`${realShape.map((event) => JSON.stringify(event)).join('\n')}\n`]),
        stdout: sink(),
        stderr: sink(),
        env: {},
      },
    )
    const broken = await runGrokObserverHook(['--root', root], {
      stdin: Readable.from(['{nope']),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    expect([first, second, stream, broken]).toEqual([0, 0, 0, 0])
    const files = readNdjson(observerInboxDir(root, 'grok-build'))
    expect(files.length).toBeGreaterThanOrEqual(2)
    expect(files.join('\n')).not.toContain('secret body')
    expect(files.join('\n')).not.toContain('hidden chain of thought')
    expect(files.join('\n')).not.toContain('full assistant response')
    expect(files.join('\n')).not.toContain('secret command catalog must vanish')
    expect(files.join('\n')).toContain('src/api/users.ts')
  })
})

describe('grok plugin discovery', () => {
  it('validates the official plugin component inventory', () => {
    const validated = spawnSync(
      'grok',
      ['plugin', 'validate', resolveGrokPluginSourceDir()],
      { encoding: 'utf8' },
    )
    if (validated.error) {
      expect(validated.error.message).not.toContain('ENOENT')
      return
    }
    expect(validated.status).toBe(0)
    expect(validated.stdout).toContain('Plugin manifest is valid.')
    expect(validated.stdout).toMatch(/0 agent dir\(s\), hooks/)
  })

  it('discovers the hook component from a temporary GROK_HOME when grok supports it', () => {
    const grokHome = createTemp()
    const isolatedHome = createTemp()
    writeFileSync(join(grokHome, 'config.toml'), 'channel = "stable"\n')
    const realConfig = join(process.env.HOME ?? '', '.grok', 'config.toml')
    const realBefore = existsSync(realConfig)
      ? {
          mtime: readFileSync(realConfig).length,
          sha: readFileSync(realConfig, 'utf8'),
        }
      : null
    const validated = spawnSync(
      'grok',
      ['plugin', 'validate', resolveGrokPluginSourceDir()],
      {
        encoding: 'utf8',
        env: isolatedEnv(grokHome, isolatedHome),
      },
    )
    expect(validated.error).toBeUndefined()
    expect(validated.status).toBe(0)
    expect(validated.stdout).toMatch(/hooks/)

    const installed = spawnSync(
      'grok',
      ['plugin', 'install', resolveGrokPluginSourceDir(), '--trust'],
      {
        encoding: 'utf8',
        env: isolatedEnv(grokHome, isolatedHome),
      },
    )
    expect(installed.status).toBe(0)
    expect(installed.stdout).toContain('sikumi-observer')
    const details = spawnSync('grok', ['plugin', 'details', GROK_PLUGIN_ID], {
      encoding: 'utf8',
      env: isolatedEnv(grokHome, isolatedHome),
    })
    expect(details.status).toBe(0)
    expect(details.stdout).toMatch(/hooks/)
    const inspected = spawnSync('grok', ['inspect', '--json'], {
      encoding: 'utf8',
      cwd: isolatedHome,
      env: isolatedEnv(grokHome, isolatedHome),
    })
    expect(inspected.status).toBe(0)
    const payload = JSON.parse(inspected.stdout) as {
      hooks: Array<{ target?: string; source?: { plugin_name?: string } }>
      plugins: Array<{ name: string; provides?: { hooks?: boolean } }>
      configSources: { layers: Array<{ path?: string }> }
    }
    expect(
      payload.plugins.some(
        (plugin) => plugin.name === GROK_PLUGIN_ID && plugin.provides?.hooks === true,
      ),
    ).toBe(true)
    expect(
      payload.hooks.some(
        (hook) =>
          hook.source?.plugin_name === GROK_PLUGIN_ID &&
          (hook.target ?? '').endsWith('hooks/hooks.json'),
      ),
    ).toBe(true)
    expect(
      payload.configSources.layers.some((layer) =>
        (layer.path ?? '').includes(grokHome),
      ),
    ).toBe(true)
    if (realBefore && existsSync(realConfig)) {
      expect(readFileSync(realConfig, 'utf8')).toBe(realBefore.sha)
    }
  })
})

function isolatedEnv(grokHome: string, home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    GROK_HOME: grokHome,
    GROK_CONFIG_HOME: grokHome,
  }
}

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
}

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'observer-grok-'))
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
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ndjson'))
    .flatMap((name) =>
      readFileSync(join(directory, name), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0),
    )
}
