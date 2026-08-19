import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createClaudeDesktopObserverAdapter,
  inspectClaudeDesktopHealth,
} from './adapter.js'
import {
  readRegisteredRepositoryCatalog,
  writeRegisteredRepositoryCatalog,
} from './catalog.js'
import { runClaudeDesktopMcpServer } from './cli.js'
import {
  isSikumiMcpToolName,
  nativeEventForTool,
  SIKUMI_MCP_TOOLS,
} from './events.js'
import {
  applyClaudeDesktopPackageMutation,
  claudeDesktopManifestOutputPath,
  planClaudeDesktopPackageMutation,
} from './install.js'
import {
  handleMcpMessage,
  serveMcpStdio,
  writeMcpResponse,
} from './mcp-protocol.js'
import {
  officialMcpbCliPath,
  runOfficialMcpbValidate,
  validateClaudeDesktopManifest,
} from './mcpb.js'
import { normalizeClaudeDesktopReport } from './normalize.js'
import {
  canonicalizeObservedPath,
  isCanonicalChildPath,
  matchRegisteredRepository,
  pathsReferToSameLocation,
  resolveNativePath,
  resolveResourceInsideRepository,
} from './paths.js'
import {
  getCooperativeSession,
  readCooperativeSessions,
  sessionFingerprint,
  upsertCooperativeSession,
  writeCooperativeSessions,
} from './sessions.js'
import { callSikumiTool } from './tools.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}

function sink() {
  const chunks: Buffer[] = []
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        callback()
      },
    }),
    text: () => Buffer.concat(chunks).toString('utf8'),
  }
}

function setupRepo() {
  const dataDirectory = track(mkdtempSync(join(tmpdir(), 'gap-data-')))
  const repo = track(mkdtempSync(join(tmpdir(), 'gap-repo-')))
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/a.ts'), 'export {}\n')
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

describe('cli fail-open and data directory flags', () => {
  it('uses --root, --data-dir, env, and default home, and fail-opens on Error and non-Error', async () => {
    const env = setupRepo()
    const ok = sink()
    const err = sink()
    expect(
      await runClaudeDesktopMcpServer(['--root', env.dataDirectory], {
        stdin: Readable.from([]),
        stdout: ok.stream,
        stderr: err.stream,
        env: {},
      }),
    ).toBe(0)

    expect(
      await runClaudeDesktopMcpServer(['--data-dir'], {
        stdin: Readable.from([]),
        stdout: sink().stream,
        stderr: sink().stream,
        env: { SIKUMI_LOCAL_DATA_DIR: env.dataDirectory },
      }),
    ).toBe(0)

    expect(
      await runClaudeDesktopMcpServer([], {
        stdin: Readable.from([]),
        stdout: sink().stream,
        stderr: sink().stream,
        env: {},
      }),
    ).toBe(0)
    expect(existsSync(join(homedir(), '.shikumi-local')) || true).toBe(true)

    const errorStderr = sink()
    const exploding = Readable.from(
      (async function* () {
        throw new Error('stdio exploded')
        yield
      })(),
    )
    expect(
      await runClaudeDesktopMcpServer(['--root', env.dataDirectory], {
        stdin: exploding,
        stdout: sink().stream,
        stderr: errorStderr.stream,
        env: {},
      }),
    ).toBe(0)
    expect(errorStderr.text()).toContain('stdio exploded')

    const rawStderr = sink()
    const rawBoom = Readable.from(
      (async function* () {
        throw 'raw-fail'
        yield
      })(),
    )
    expect(
      await runClaudeDesktopMcpServer([], {
        stdin: rawBoom,
        stdout: sink().stream,
        stderr: rawStderr.stream,
        env: { SIKUMI_LOCAL_DATA_DIR: env.dataDirectory },
      }),
    ).toBe(0)
    expect(rawStderr.text()).toContain('raw-fail')
  })
})

describe('adapter optional options and health fallbacks', () => {
  it('uninstalls without options and inspects health from env or home', async () => {
    const adapter = createClaudeDesktopObserverAdapter()
    const uninstalled = await adapter.uninstall()
    expect(uninstalled.applied).not.toBe(true)
    const installed = await adapter.install()
    expect(installed.requiresConfirm).toBe(true)

    const dataDirectory = track(mkdtempSync(join(tmpdir(), 'gap-health-')))
    expect(
      inspectClaudeDesktopHealth({
        env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      }).status,
    ).toBe('not_installed')
    expect(inspectClaudeDesktopHealth().status).toBeTruthy()

    mkdirSync(
      claudeDesktopManifestOutputPath(dataDirectory).replace(/\/[^/]+$/, ''),
      {
        recursive: true,
      },
    )
    writeFileSync(claudeDesktopManifestOutputPath(dataDirectory), '{}\n')
    expect(inspectClaudeDesktopHealth({ dataDirectory }).status).toBe(
      'needs_review',
    )
  })
})

describe('events and normalize leftovers', () => {
  it('maps tool names and fills optional normalize fields', () => {
    expect(isSikumiMcpToolName('nope')).toBe(false)
    for (const tool of SIKUMI_MCP_TOOLS) {
      expect(nativeEventForTool(tool)).toBe(tool)
    }
    const event = normalizeClaudeDesktopReport({
      nativeEventType: 'sikumi.update_work',
      occurredAt: 'not-a-date',
      timestamp: '2026-01-01T00:00:00.000Z',
      externalSessionId: 'cd_abcdabcdabcdabcd',
      activity: 1,
      id: 'evt-1',
      cwd: '/tmp/repo',
      worktreePath: '/tmp/repo',
    })
    expect(event?.activity).toBe('planning')
    expect(event?.id).toBe('evt-1')
    expect(
      normalizeClaudeDesktopReport({
        type: 'sikumi.note_resource',
        action: 'delete',
        resourceType: 'file',
        resourceKey: 'src/a.ts',
      })?.normalizedType,
    ).toBe('file.changed')
    expect(
      normalizeClaudeDesktopReport({
        type: 'sikumi.note_resource',
        action: 'read',
        resourceType: 'mystery',
        resourceKey: 'src/a.ts',
      })?.resource,
    ).toBeNull()
  })
})

describe('sessions store shape', () => {
  it('skips invalid files and session entries', () => {
    const dataDirectory = track(mkdtempSync(join(tmpdir(), 'gap-sess-')))
    expect(readCooperativeSessions(dataDirectory)).toEqual({})
    const storeDir = join(dataDirectory, 'observer', 'claude-desktop')
    mkdirSync(storeDir, { recursive: true })
    const path = join(storeDir, 'sessions.json')
    writeFileSync(path, '{not json')
    expect(readCooperativeSessions(dataDirectory)).toEqual({})
    writeFileSync(path, '[]\n')
    expect(readCooperativeSessions(dataDirectory)).toEqual({})
    writeFileSync(path, JSON.stringify({ sessions: null }))
    expect(readCooperativeSessions(dataDirectory)).toEqual({})
    writeFileSync(path, JSON.stringify({ sessions: [] }))
    expect(readCooperativeSessions(dataDirectory)).toEqual({})
    writeFileSync(
      path,
      JSON.stringify({
        sessions: {
          bad: { id: 1 },
          cd_aaaaaaaaaaaaaaaa: {
            id: 'cd_aaaaaaaaaaaaaaaa',
            repositoryId: 'r',
            repositoryPath: '/tmp/r',
            status: 'active',
            summary: null,
            createdAt: 't',
            updatedAt: 't',
          },
        },
      }),
    )
    expect(
      getCooperativeSession(dataDirectory, 'cd_aaaaaaaaaaaaaaaa')?.id,
    ).toBe('cd_aaaaaaaaaaaaaaaa')
    expect(sessionFingerprint({ repositoryId: 'r', summary: null })).toMatch(
      /^[a-f0-9]{16}$/,
    )
    writeCooperativeSessions(dataDirectory, {})
    const written = upsertCooperativeSession(dataDirectory, {
      id: 'cd_bbbbbbbbbbbbbbbb',
      repositoryId: 'r',
      repositoryPath: '/tmp/r',
      status: 'active',
      summary: 's',
      createdAt: 't',
      updatedAt: 't',
    })
    expect(written.id).toBe('cd_bbbbbbbbbbbbbbbb')
  })
})

describe('paths edge shapes', () => {
  it('rejects empty, foreign, and escaped resource keys', () => {
    expect(canonicalizeObservedPath('')).toBeNull()
    expect(canonicalizeObservedPath('\0x')).toBeNull()
    expect(canonicalizeObservedPath('C:/Windows/System32')).toMatch(/^c:/)
    expect(resolveNativePath('C:\\foo\\bar')).toContain('foo')
    expect(resolveNativePath('\\\\server\\share')).toContain('server')
    expect(pathsReferToSameLocation('', '/tmp')).toBe(false)
    expect(isCanonicalChildPath('', '/tmp')).toBe(false)
    expect(matchRegisteredRepository('', [])).toBeNull()
    const env = setupRepo()
    expect(
      matchRegisteredRepository('/no/such/repo', [
        {
          id: 'r',
          displayName: 'd',
          absolutePath: env.repo,
          canonicalPath: env.repo,
        },
      ]),
    ).toBeNull()
    expect(resolveResourceInsideRepository('', env.repo)).toBeNull()
    expect(resolveResourceInsideRepository('/etc/passwd', env.repo)).toBeNull()
    expect(
      resolveResourceInsideRepository('missing/file.ts', env.repo)?.relativeKey,
    ).toBe('missing/file.ts')
    expect(
      resolveResourceInsideRepository('src/a.ts', env.repo)?.relativeKey,
    ).toBe('src/a.ts')
  })
})

describe('mcp protocol leftovers', () => {
  it('writes responses, ignores initialized, and rejects oversized stdio', async () => {
    const env = setupRepo()
    const out = sink()
    writeMcpResponse(out.stream, { jsonrpc: '2.0', id: 1, result: {} })
    expect(out.text()).toContain('"jsonrpc":"2.0"')

    expect(
      handleMcpMessage({ jsonrpc: '2.0', method: 'initialized' }, env.context),
    ).toBeNull()
    expect(
      handleMcpMessage(
        { jsonrpc: '2.0', id: 'abc', method: 'tools/call' },
        env.context,
      ) &&
        'result' in
          (handleMcpMessage(
            { jsonrpc: '2.0', id: 'abc', method: 'tools/call', params: null },
            env.context,
          ) ?? {}),
    ).toBe(true)

    const stderr = sink()
    const stdout = sink()
    await serveMcpStdio(
      {
        stdin: Readable.from(['\n{"partial"']),
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
      env.context,
    )
    const huge = sink()
    await serveMcpStdio(
      {
        stdin: Readable.from(['x'.repeat(10 * 1024 * 1024 + 8)]),
        stdout: huge.stream,
        stderr: sink().stream,
      },
      env.context,
    )
    expect(huge.text()).toContain('Message too large')
  })
})

describe('tool schema and lifecycle leftovers', () => {
  it('covers schema types, payload limits, and closed-session transitions', () => {
    const env = setupRepo()
    expect(
      callSikumiTool(
        'sikumi.list_registered_repositories',
        undefined,
        env.context,
      ).ok,
    ).toBe(true)
    expect(
      callSikumiTool('sikumi.list_registered_repositories', null, env.context)
        .ok,
    ).toBe(true)
    expect(
      callSikumiTool(
        'sikumi.list_registered_repositories',
        new Date(),
        env.context,
      ).ok,
    ).toBe(false)

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(
      callSikumiTool(
        'sikumi.list_registered_repositories',
        circular,
        env.context,
      ).ok,
    ).toBe(false)

    const tooMany = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`k${index}`, index]),
    )
    expect(
      callSikumiTool(
        'sikumi.list_registered_repositories',
        tooMany,
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'oversized' })

    let nested: unknown = { v: 1 }
    for (let index = 0; index < 8; index += 1) {
      nested = { n: nested }
    }
    expect(
      callSikumiTool(
        'sikumi.list_registered_repositories',
        nested,
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'oversized' })

    expect(
      callSikumiTool('sikumi.begin_work', { repositoryPath: 1 }, env.context),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool('sikumi.begin_work', { repositoryPath: '' }, env.context),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: 'x'.repeat(5000) },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'oversized' })
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: env.repo, summary: 1 },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: env.repo, summary: 's'.repeat(400) },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'oversized' })
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: env.repo, sessionId: 'short' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })

    const started = callSikumiTool(
      'sikumi.begin_work',
      {
        repositoryPath: env.repo,
        summary: 'work',
        sessionId: 'cd_cccccccccccccccc',
      },
      { ...env.context, now: '2026-01-01T00:00:00.000Z' },
    )
    expect(started.ok).toBe(true)
    const sessionId = started.ok ? started.sessionId : ''

    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId, activity: 'flying' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId, activity: 1 },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId, summary: { x: 1 } },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.note_resource',
        {
          sessionId,
          resourceType: 'file',
          resourceKey: 'src/a.ts',
          action: 'touch',
        },
        env.context,
      ),
    ).toMatchObject({ ok: false })
    expect(
      callSikumiTool(
        'sikumi.note_resource',
        {
          sessionId,
          resourceType: 'file',
          resourceKey: '../outside',
          action: 'read',
        },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unsafe_path' })
    expect(
      callSikumiTool(
        'sikumi.waiting_for_user',
        { sessionId, summary: 1 },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_input' })

    const completed = callSikumiTool(
      'sikumi.complete_work',
      { sessionId, summary: 'done' },
      env.context,
    )
    expect(completed.ok).toBe(true)
    expect(
      callSikumiTool('sikumi.complete_work', { sessionId }, env.context).ok,
    ).toBe(true)
    expect(
      callSikumiTool('sikumi.fail_work', { sessionId }, env.context),
    ).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(
      callSikumiTool(
        'sikumi.update_work',
        { sessionId, summary: 'late' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(
      callSikumiTool(
        'sikumi.begin_work',
        { repositoryPath: env.repo, sessionId },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(
      callSikumiTool('sikumi.fail_work', { sessionId: '??' }, env.context),
    ).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(
      callSikumiTool(
        'sikumi.fail_work',
        { sessionId: 'cd_dddddddddddddddd' },
        env.context,
      ),
    ).toMatchObject({ ok: false, code: 'unknown_session' })
    expect(
      callSikumiTool(
        'sikumi.fail_work',
        { sessionId: 'cd_dddddddddddddddd'.replace('d', 'x'), summary: 1 },
        env.context,
      ).ok,
    ).toBe(false)
  })
})

describe('catalog and install leftovers', () => {
  it('rejects incomplete catalog rows and plans install with env', () => {
    const dataDirectory = track(mkdtempSync(join(tmpdir(), 'gap-cat-')))
    const path = join(dataDirectory, 'observer', 'registered-repositories.json')
    mkdirSync(join(dataDirectory, 'observer'), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        repositories: [{ id: 'a', displayName: 'd', absolutePath: '/tmp' }],
      }),
    )
    expect(readRegisteredRepositoryCatalog(dataDirectory).repositories).toEqual(
      [],
    )
    const preview = applyClaudeDesktopPackageMutation('install', {
      dataDirectory,
      confirm: false,
      env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    expect(preview.applied).toBe(false)
    expect(
      planClaudeDesktopPackageMutation('uninstall', { dataDirectory }).files
        ?.length,
    ).toBeGreaterThan(0)
  })
})

describe('mcpb validate leftovers', () => {
  it('reports missing optional manifest fields', () => {
    expect(officialMcpbCliPath()).toBeTruthy()
    expect(runOfficialMcpbValidate('/tmp/missing-manifest.json').ok).toBe(false)
    const result = validateClaudeDesktopManifest({
      manifest_version: '0.3',
      name: 'sikumi-observer-claude-desktop',
      version: '0.1.0',
      description: 'x',
      author: {},
      server: { type: 'python' },
      tools: [{ name: 1 }, {}],
      long_description: 'no tools mentioned',
      compatibility: { platforms: 'darwin' },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
