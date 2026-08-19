import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
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
import { createClaudeDesktopObserverAdapter } from './adapter.js'
import { writeRegisteredRepositoryCatalog } from './catalog.js'
import { runClaudeDesktopMcpServer } from './cli.js'
import {
  CLAUDE_DESKTOP_SOURCE,
  SIKUMI_MCP_TOOLS,
} from './events.js'
import {
  applyClaudeDesktopPackageMutation,
  claudeDesktopMcpbPath,
  planClaudeDesktopPackageMutation,
} from './install.js'
import { handleMcpMessage, serializeMcpMessage } from './mcp-protocol.js'
import {
  assertArchiveRuntimeComplete,
  packageClaudeDesktopMcpb,
  renderClaudeDesktopManifest,
  runOfficialMcpbValidate,
  unpackClaudeDesktopMcpb,
  validateClaudeDesktopManifest,
} from './mcpb.js'
import { normalizeClaudeDesktopReport } from './normalize.js'
import { callSikumiTool, listSikumiTools } from './tools.js'

const tempDirectories: string[] = []
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('sikumi MCP tools', () => {
  it('exposes exactly the seven cooperative tools', () => {
    expect(listSikumiTools().map((tool) => tool.name)).toEqual([
      ...SIKUMI_MCP_TOOLS,
    ])
    for (const tool of listSikumiTools()) {
      expect(tool.description).toMatch(/協調報告|Cooperative|cooperative/)
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
    }
  })

  it('lists only registered repositories and begins/updates/notes/waits/completes/fails', () => {
    const env = setupRepo()
    const listed = callSikumiTool(
      'sikumi.list_registered_repositories',
      {},
      env.context,
    )
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.repositories?.map((item) => item.id)).toEqual(['repo-1'])
    }

    const begun = callSikumiTool(
      'sikumi.begin_work',
      {
        repositoryPath: env.repo,
        summary: 'プロフィール画像機能を追加する',
        prompt: 'this must be rejected',
      },
      env.context,
    )
    expect(begun.ok).toBe(false)

    const started = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: env.repo, summary: 'プロフィール画像機能を追加する' },
      env.context,
    )
    expect(started.ok).toBe(true)
    if (!started.ok) {
      return
    }
    const sessionId = started.sessionId
    expect(sessionId).toMatch(/^cd_[a-f0-9]{32}$/)
    expect(started.status).toBe('active')

    const again = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: env.repo, summary: '別作業', sessionId },
      env.context,
    )
    expect(again.ok).toBe(true)
    if (again.ok) {
      expect(again.sessionId).toBe(sessionId)
      expect(again.message).toContain('再実行')
    }

    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId, summary: '範囲をプロフィール周辺へ更新' },
        env.context,
      ).ok,
    ).toBe(true)
    writeFileSync(join(env.repo, 'src/profile/avatar.tsx'), 'export const x = 1\n')
    const noted = callSikumiTool(
      'sikumi.note_resource',
      {
        sessionId,
        resourceType: 'file',
        resourceKey: 'src/profile/avatar.tsx',
        action: 'write',
      },
      env.context,
    )
    expect(noted.ok).toBe(true)
    expect(
      callSikumiTool(
        'sikumi.waiting_for_user',
        { sessionId, summary: '確認待ち' },
        env.context,
      ).ok,
    ).toBe(true)
    const completed = callSikumiTool(
      'sikumi.complete_work',
      { sessionId },
      env.context,
    )
    expect(completed.ok).toBe(true)
    if (completed.ok) {
      expect(completed.status).toBe('completed')
    }
    const completedAgain = callSikumiTool(
      'sikumi.complete_work',
      { sessionId },
      env.context,
    )
    expect(completedAgain.ok).toBe(true)
    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId, summary: 'already closed' },
        env.context,
      ).ok,
    ).toBe(false)
  })

  it('rejects unregistered paths, traversal, symlink escape, unknown sessions, and oversized values', () => {
    const env = setupRepo()
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: '/tmp/not-registered' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unregistered_repository' })
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: `${env.repo}/../escape` },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unregistered_repository' })

    const started = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: env.repo, summary: 'safe' },
      env.context,
    )
    expect(started.ok).toBe(true)
    if (!started.ok) {
      return
    }
    const outside = track(mkdtempSync(join(tmpdir(), 'outside-')))
    writeFileSync(join(outside, 'secret.env'), 'TOKEN=1\n')
    const link = join(env.repo, 'src', 'escape')
    symlinkSync(outside, link)
    expect(
      callSikumiTool(
        'sikumi.note_resource',
        {
          sessionId: started.sessionId,
          resourceType: 'file',
          resourceKey: 'src/escape/secret.env',
          action: 'read',
        },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unsafe_path' })
    expect(
      callSikumiTool(
        'sikumi.note_resource',
        {
          sessionId: started.sessionId,
          resourceType: 'file',
          resourceKey: '../outside.txt',
          action: 'read',
        },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unsafe_path' })
    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId: 'missing-session-id' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unknown_session' })
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: env.repo, summary: 's'.repeat(400) },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'oversized' })
    expect(
      callSikumiTool(
        'sikumi.fail_work',
        { sessionId: started.sessionId },
        env.context,
      ).ok,
    ).toBe(true)
    expect(
      callSikumiTool(
        'sikumi.complete_work',
        { sessionId: started.sessionId },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_transition' })
  })

  it('accepts Windows-style registered path representations without leaving the repo', () => {
    const env = setupRepo()
    writeRegisteredRepositoryCatalog(env.dataDirectory, [
      {
        id: 'win-repo',
        displayName: 'win',
        absolutePath: 'C:\\Users\\example\\Projects\\app',
      },
    ])
    const listed = callSikumiTool(
      'sikumi.list_registered_repositories',
      {},
      env.context,
    )
    expect(listed.ok).toBe(true)
    const started = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: 'C:/Users/example/Projects/app', summary: 'win path' },
      env.context,
    )
    expect(started.ok).toBe(true)
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: 'C:\\Users\\example\\Projects\\other', summary: 'no' },
        env.context,
      ).ok,
    ).toBe(false)
  })

  it('rejects child directories and accepts only the registered realpath root', () => {
    const env = setupRepo()
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: join(env.repo, 'src'), summary: 'child' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unregistered_repository' })

    const aliasDir = track(mkdtempSync(join(tmpdir(), 'alias-parent-')))
    const alias = join(aliasDir, 'same-root')
    symlinkSync(env.repo, alias)
    const viaAlias = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: alias, summary: 'alias' },
      env.context,
    )
    expect(viaAlias.ok).toBe(true)

    const outside = track(mkdtempSync(join(tmpdir(), 'outside-root-')))
    const escapeAlias = join(aliasDir, 'escape-root')
    symlinkSync(outside, escapeAlias)
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: escapeAlias, summary: 'escape' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unregistered_repository' })
  })

  it('rejects begin_work when the supplied sessionId belongs to another repository', () => {
    const env = setupRepo()
    const other = track(mkdtempSync(join(tmpdir(), 'claude-repo-2-')))
    writeRegisteredRepositoryCatalog(env.dataDirectory, [
      {
        id: 'repo-1',
        displayName: 'demo',
        absolutePath: env.repo,
      },
      {
        id: 'repo-2',
        displayName: 'other',
        absolutePath: realpathSync(other),
      },
    ])
    const started = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: env.repo, summary: 'first repo' },
      env.context,
    )
    expect(started.ok).toBe(true)
    if (!started.ok) {
      return
    }
    const inbox = observerInboxDir(env.dataDirectory, 'claude-desktop')
    const before = readdirSync(inbox)
      .filter((name) => name.endsWith('.ndjson'))
      .map((name) => readFileSync(join(inbox, name), 'utf8'))
      .join('\n')
    const conflicted = callSikumiTool(
      'sikumi.begin_work',
      {
        repositoryPath: other,
        summary: 'second repo',
        sessionId: started.sessionId,
      },
      env.context,
    )
    expect(conflicted).toMatchObject({
      ok: false,
      code: 'invalid_transition',
    })
    const after = readdirSync(inbox)
      .filter((name) => name.endsWith('.ndjson'))
      .map((name) => readFileSync(join(inbox, name), 'utf8'))
      .join('\n')
    expect(after).toBe(before)
    expect(after).not.toContain(realpathSync(other))
  })

  it('keeps the original summary on idempotent begin_work for the same repository', () => {
    const env = setupRepo()
    const started = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: env.repo, summary: '最初の要約' },
      env.context,
    )
    expect(started.ok).toBe(true)
    if (!started.ok) {
      return
    }
    const again = callSikumiTool(
      'sikumi.begin_work',
      {
        repositoryPath: env.repo,
        summary: '別の要約',
        sessionId: started.sessionId,
      },
      env.context,
    )
    expect(again.ok).toBe(true)
    if (again.ok) {
      expect(again.reported).toBe(false)
      expect(again.sessionId).toBe(started.sessionId)
    }
    const inbox = observerInboxDir(env.dataDirectory, 'claude-desktop')
    const raw = readdirSync(inbox)
      .filter((name) => name.endsWith('.ndjson'))
      .map((name) => readFileSync(join(inbox, name), 'utf8'))
      .join('\n')
    expect(raw).toContain('最初の要約')
    expect(raw).not.toContain('別の要約')
  })

  it('enforces each tool schema in the handler, not via the host', () => {
    const env = setupRepo()
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: env.repo, extra: 'nope' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: env.repo, summary: 12 },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    const started = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: env.repo, summary: 'schema' },
      env.context,
    )
    expect(started.ok).toBe(true)
    if (!started.ok) {
      return
    }
    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId: started.sessionId, activity: 'dancing' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId: started.sessionId, summary: { text: 'no' } },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.note_resource',
        {
          sessionId: started.sessionId,
          resourceType: 'file',
          resourceKey: 'src/profile/avatar.tsx',
          action: 'write',
          nested: { prompt: 'hidden' },
        },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.complete_work',
        { sessionId: started.sessionId, token: 'sk-live' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    const deep: Record<string, unknown> = { repositoryPath: env.repo }
    let cursor: Record<string, unknown> = deep
    for (let index = 0; index < 8; index += 1) {
      const next: Record<string, unknown> = {}
      cursor.child = next
      cursor = next
    }
    expect(
      callSikumiTool('sikumi.begin_work', deep, env.context),
    ).toMatchObject({ ok: false, code: 'oversized' })
  })
})

describe('normalize and spool', () => {
  it('emits reported desktop-app MCP events and drops prompt/content/secrets', () => {
    const env = setupRepo()
    const started = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: env.repo, summary: '作業開始' },
      env.context,
    )
    expect(started.ok).toBe(true)
    const inbox = observerInboxDir(env.dataDirectory, 'claude-desktop')
    const files = readdirSync(inbox).filter((name) => name.endsWith('.ndjson'))
    expect(files.length).toBeGreaterThan(0)
    const raw = files
      .map((name) => readFileSync(join(inbox, name), 'utf8'))
      .join('\n')
    expect(raw).not.toContain('sk-live')
    expect(raw).not.toContain('full prompt')
    const parsed = JSON.parse(raw.split('\n')[0] ?? '{}') as {
      source: string
      surface: string
      ingestionMethod: string
      attributionConfidence: string
      summary: string
    }
    expect(parsed.source).toBe('claude-desktop')
    expect(parsed.surface).toBe('desktop-app')
    expect(parsed.ingestionMethod).toBe('mcp')
    expect(parsed.attributionConfidence).toBe('reported')
    expect(parsed.summary).toBe('作業開始')

    const normalized = normalizeClaudeDesktopReport({
      type: 'sikumi.note_resource',
      sessionId: 'cd_abc12345',
      resourceType: 'file',
      resourceKey: 'src/profile/avatar.tsx',
      action: 'write',
      prompt: 'full prompt must vanish',
      content: 'file body must vanish',
      token: 'sk-live-secret',
    })
    expect(normalized?.source).toBe(CLAUDE_DESKTOP_SOURCE)
    expect(normalized?.normalizedType).toBe('file.changed')
    expect(JSON.stringify(normalized)).not.toContain('full prompt must vanish')
    expect(JSON.stringify(normalized)).not.toContain('file body must vanish')
    expect(JSON.stringify(normalized)).not.toContain('sk-live-secret')
  })

  it('fail-opens when the spool directory cannot be written', () => {
    const env = setupRepo()
    writeFileSync(join(env.dataDirectory, 'observer', 'inbox'), 'blocked')
    const started = callSikumiTool(
      'sikumi.begin_work',
      { repositoryPath: env.repo, summary: 'fail-open' },
      env.context,
    )
    expect(started.ok).toBe(true)
    if (started.ok) {
      expect(started.reported).toBe(false)
      expect(started.sessionId).toBeTruthy()
    }
  })
})

describe('MCP protocol', () => {
  it('handles initialize, tools/list, and tools/call in-process', () => {
    const env = setupRepo()
    const initialized = handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      },
      env.context,
    )
    expect(initialized?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'sikumi-observer-claude-desktop' },
    })
    expect(JSON.stringify(initialized)).toContain('sikumi.begin_work')

    const listed = handleMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      env.context,
    )
    const tools = (
      listed?.result as { tools: Array<{ name: string }> } | undefined
    )?.tools
    expect(tools?.map((tool) => tool.name)).toEqual([...SIKUMI_MCP_TOOLS])

    const called = handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'sikumi.begin_work',
          arguments: { repositoryPath: env.repo, summary: 'MCP call' },
        },
      },
      env.context,
    )
    const payload = JSON.parse(
      (
        called?.result as {
          content: Array<{ text: string }>
          isError: boolean
        }
      ).content[0]?.text ?? '{}',
    ) as { ok: boolean; sessionId?: string }
    expect(called && 'result' in called && called.result).toBeTruthy()
    expect(
      (called?.result as { isError?: boolean } | undefined)?.isError,
    ).toBe(false)
    expect(payload.ok).toBe(true)
    expect(payload.sessionId).toBeTruthy()
  })

  it('speaks MCP over stdio with newline-delimited JSON-RPC', async () => {
    const env = setupRepo()
    const input = [
      rpc('initialize', 1, { protocolVersion: '2025-06-18' }),
      rpc('notifications/initialized'),
      rpc('ping', 2),
      rpc('tools/list', 3),
      rpc('tools/call', 4, {
        name: 'sikumi.list_registered_repositories',
        arguments: {},
      }),
    ].join('')
    const stderrChunks: Buffer[] = []
    const { stdin, stdout, output } = memoryStdio(input)
    const code = await runClaudeDesktopMcpServer(['--data-dir', env.dataDirectory], {
      stdin,
      stdout,
      stderr: new Writable({
        write(chunk, _encoding, callback) {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
          callback()
        },
      }),
      env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: env.dataDirectory },
    })
    expect(code).toBe(0)
    const body = output().toString('utf8')
    expect(body).not.toContain('Content-Length:')
    expect(body).toContain('sikumi.begin_work')
    expect(body).toContain('sikumi.complete_work')
    expect(body).toContain('registered')
    const lines = body.split('\n').filter((line) => line.length > 0)
    expect(lines.length).toBeGreaterThanOrEqual(4)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
    expect(body).not.toMatch(/^[^{]/)
    expect(stderrChunks.join('')).not.toContain('Content-Length:')
  })

  it('marks failed tool calls with isError and keeps protocol errors visible', () => {
    const env = setupRepo()
    const called = handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'sikumi.begin_work',
          arguments: { repositoryPath: '/tmp/not-registered' },
        },
      },
      env.context,
    )
    expect((called?.result as { isError?: boolean } | undefined)?.isError).toBe(
      true,
    )
    const payload = JSON.parse(
      (
        called?.result as {
          content: Array<{ text: string }>
        }
      ).content[0]?.text ?? '{}',
    ) as { ok: boolean; code?: string }
    expect(payload.ok).toBe(false)
    expect(payload.code).toBe('unregistered_repository')
    const unknown = handleMcpMessage(
      { jsonrpc: '2.0', id: 10, method: 'boom' },
      env.context,
    )
    expect(unknown?.error?.code).toBe(-32601)
  })
})

describe('adapter install and health', () => {
  it('previews a package, writes only into the data directory, and stays cooperative', () => {
    const dataDirectory = track(mkdtempSync(join(tmpdir(), 'claude-install-')))
    const preview = planClaudeDesktopPackageMutation('install', { dataDirectory })
    expect(preview.requiresConfirm).toBe(true)
    expect(preview.changed).toBe(false)
    expect(preview.message).toContain('協調報告')
    expect(preview.message).toContain('自動全観測ではありません')
    expect(preview.evidence?.join('\n')).toContain('Settings > Extensions')

    const identified = applyClaudeDesktopPackageMutation('install', {
      dataDirectory,
      confirm: false,
    })
    const digest = identified.planDigest ?? identified.confirmationToken
    expect(digest).toBeTruthy()
    const confirmed = applyClaudeDesktopPackageMutation('install', {
      dataDirectory,
      confirm: true,
      ...(digest ? { confirmationToken: digest, planDigest: digest } : {}),
    })
    expect(confirmed.applied).toBe(true)
    expect(existsSync(claudeDesktopMcpbPath(dataDirectory))).toBe(true)
    expect(existsSync(join(dataDirectory, 'Library'))).toBe(false)
    expect(readFileSync(join(dataDirectory, 'observer/claude-desktop/bundle/manifest.json'), 'utf8')).toContain(
      'sikumi.begin_work',
    )

    const adapter = createClaudeDesktopObserverAdapter()
    const event = adapter.normalize({
      type: 'sikumi.begin_work',
      sessionId: 'cd_deadbeefdeadbeef',
      summary: 'reported',
    })
    expect(event?.attributionConfidence).toBe('reported')
    expect(event?.ingestionMethod).toBe('mcp')
    expect(confirmed.ok).toBe(true)
  })

  it('promotes health only after a cooperative event and never claims full observation', async () => {
    const dataDirectory = track(mkdtempSync(join(tmpdir(), 'claude-health-')))
    const adapter = createClaudeDesktopObserverAdapter()
    const missing = await adapter.healthCheck({ dataDirectory })
    expect(missing.status).toBe('not_installed')
    expect(missing.warnings.join('\n')).toContain('制限付き')

    const digest = digestFor(dataDirectory)
    await adapter.install({
      dataDirectory,
      confirm: true,
      ...(digest.confirmationToken
        ? { confirmationToken: digest.confirmationToken }
        : {}),
      ...(digest.planDigest ? { planDigest: digest.planDigest } : {}),
    })
    const pending = await adapter.healthCheck({ dataDirectory })
    expect(pending.status).toBe('needs_review')
    expect(pending.warnings.join('\n')).toContain('協調報告')
    expect(pending.warnings.join('\n')).not.toContain('自動全観測')

    const ready = await adapter.healthCheck({
      dataDirectory,
      lastEventAt: '2026-08-18T00:00:00.000Z',
    })
    expect(ready.status).toBe('ready')
    expect(ready.warnings.join('\n')).toContain('協調報告を受信済み')
  })
})

describe('MCPB manifest and package', () => {
  it('validates the source manifest and keeps pack file lists deterministic', () => {
    const source = JSON.parse(
      readFileSync(join(packageRoot, 'extension/manifest.json'), 'utf8'),
    ) as unknown
    expect(validateClaudeDesktopManifest(source).ok).toBe(true)
    expect(validateClaudeDesktopManifest(renderClaudeDesktopManifest()).ok).toBe(
      true,
    )
    const official = runOfficialMcpbValidate(
      join(packageRoot, 'extension/manifest.json'),
    )
    expect(official.ok).toBe(true)

    const firstOut = join(track(mkdtempSync(join(tmpdir(), 'mcpb-a-'))), 'a.mcpb')
    const secondOut = join(track(mkdtempSync(join(tmpdir(), 'mcpb-b-'))), 'b.mcpb')
    const first = packageClaudeDesktopMcpb(firstOut)
    const second = packageClaudeDesktopMcpb(secondOut)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(first.usedOfficialCli).toBe(true)
    expect(first.files).toEqual(second.files)
    expect(first.files).toContain('manifest.json')
    expect(first.files).toContain('package.json')
    expect(first.files).toContain('server/index.js')
    expect(first.files).toContain('server/cli.js')
    expect(first.files).toContain('server/package.json')
    expect(
      first.files.some((name) =>
        name.includes('server/node_modules/@sikumi-local/observer-core/package.json'),
      ),
    ).toBe(true)
    expect(
      first.files.some((name) => name.includes('server/node_modules/zod/package.json')),
    ).toBe(true)
    const extracted = track(mkdtempSync(join(tmpdir(), 'mcpb-extract-')))
    unpackClaudeDesktopMcpb(firstOut, extracted)
    expect(assertArchiveRuntimeComplete(extracted)).toEqual([])
    const script = spawnSync(process.execPath, [
      join(packageRoot, 'scripts/validate.mjs'),
    ])
    expect(script.status).toBe(0)
  })
})

function setupRepo(): {
  readonly dataDirectory: string
  readonly repo: string
  readonly context: { readonly dataDirectory: string }
} {
  const dataDirectory = track(mkdtempSync(join(tmpdir(), 'claude-data-')))
  const repo = track(mkdtempSync(join(tmpdir(), 'claude-repo-')))
  mkdirSync(join(repo, 'src/profile'), { recursive: true })
  writeFileSync(join(repo, 'src/profile/avatar.tsx'), 'export const n = 1\n')
  writeRegisteredRepositoryCatalog(dataDirectory, [
    {
      id: 'repo-1',
      displayName: 'demo',
      absolutePath: realpathSync(repo),
    },
  ])
  return {
    dataDirectory,
    repo: realpathSync(repo),
    context: { dataDirectory },
  }
}

function digestFor(dataDirectory: string): {
  readonly confirmationToken?: string
  readonly planDigest?: string
} {
  const preview = applyClaudeDesktopPackageMutation('install', {
    dataDirectory,
    confirm: false,
  })
  return {
    ...(preview.confirmationToken
      ? { confirmationToken: preview.confirmationToken }
      : {}),
    ...(preview.planDigest ? { planDigest: preview.planDigest } : {}),
  }
}

function rpc(method: string, id?: number, params?: unknown): string {
  return serializeMcpMessage({
    jsonrpc: '2.0',
    ...(id === undefined ? {} : { id }),
    method,
    ...(params === undefined ? {} : { params }),
  })
}

function memoryStdio(input: string): {
  readonly stdin: Readable
  readonly stdout: Writable
  readonly output: () => Buffer
} {
  const chunks: Buffer[] = []
  return {
    stdin: Readable.from([input]),
    stdout: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        callback()
      },
    }),
    output: () => Buffer.concat(chunks),
  }
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
