import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyConfirmedInstallPlan,
  attachInstallPlanIdentity,
  assertInstallNotImplemented,
  buildIdempotencyKey,
  classifyChangedPath,
  classifyCommandCategory,
  confidenceLabel,
  containsParentTraversal,
  createDeferredObserverAdapter,
  defaultObserverAdapters,
  displayNameForSource,
  extractApplyPatchPaths,
  extractToolFilePaths,
  inferNormalizedType,
  INSTALL_PLAN_DIGEST_MISMATCH_MESSAGE,
  installationStatusLabel,
  isObserverDateTime,
  isRealUserHomePath,
  isSafeRelativePath,
  normalizeObserverDateTime,
  normalizeObserverPath,
  pickAllowlistedPayload,
  projectInboundEvent,
  relativeTimeLabel,
  rememberAdapterObservation,
  sanitizeObserverSummary,
  conflictHeadline,
  scoreToConflictLevel,
  shouldGrantRealUserApply,
  toRepoRelativePath,
  toSafeHookCommand,
  unavailableHealth,
  aggregateCursorTabSessions,
  classifyObservedVersion,
  parseSemver,
  probeCommandVersion,
} from './index.js'
import {
  inboundObserverEventSchema,
  observerAdapterActionRequestSchema,
} from './schemas.js'
import { assertEventSizeLimit, OBSERVER_MAX_EVENT_BYTES } from './redaction.js'

describe('observer-core types', () => {
  it('uses cautious Japanese labels instead of AI or Git claims', () => {
    expect(installationStatusLabel('needs_review')).toBe('要レビュー')
    expect(installationStatusLabel('degraded')).toBe('劣化')
    expect(displayNameForSource('git')).toBe('変更元不明')
    expect(confidenceLabel('inferred')).toBe('変更元不明')
    expect(scoreToConflictLevel(85)).toBe('high')
    expect(scoreToConflictLevel(92)).toBe('critical')
    expect(conflictHeadline('high')).toBe('🔴 同じ仕組みを変更しています')
    expect(classifyChangedPath('src/auth/session.ts').label).toBe('ログイン状態')
    expect(relativeTimeLabel(new Date(Date.now() - 2 * 60_000).toISOString())).toBe(
      '2分前',
    )
  })
})

describe('redaction', () => {
  it('keeps allowlisted metadata and drops prompt, transcript, and secrets', () => {
    const picked = pickAllowlistedPayload({
      toolName: 'Edit',
      filePath: 'src/auth/session.ts',
      prompt: 'do not store me',
      transcript: 'full conversation',
      token: 'sk-live-secret-value',
      commandName: 'pnpm test',
    })
    expect(picked).toEqual({
      toolName: 'Edit',
      filePath: 'src/auth/session.ts',
      commandName: 'pnpm test',
    })
    expect(sanitizeObserverSummary('TOKEN=sk-live-secret-value')).toBeNull()
    expect(sanitizeObserverSummary('認証まわりを直しています')).toBe(
      '認証まわりを直しています',
    )
  })

  it('rejects oversized raw events', () => {
    expect(() =>
      assertEventSizeLimit('x'.repeat(OBSERVER_MAX_EVENT_BYTES + 1)),
    ).toThrow(AppError)
  })
})

describe('paths', () => {
  it('normalizes repository-relative paths and rejects traversal', () => {
    expect(normalizeObserverPath('src\\\\auth\\\\session.ts')).toBe(
      'src/auth/session.ts',
    )
    expect(toRepoRelativePath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(isSafeRelativePath('src/a.ts')).toBe(true)
    expect(isSafeRelativePath('../secret')).toBe(false)
    expect(containsParentTraversal('foo/\u2025/passwd')).toBe(true)
    expect(() => normalizeObserverPath('../etc/passwd')).toThrow(AppError)
  })
})

describe('projectInboundEvent', () => {
  it('maps a generic hook payload without keeping prompt text', () => {
    const event = projectInboundEvent({
      source: 'codex',
      hook_event_name: 'SessionStart',
      session_id: 'sess-1',
      cwd: '/Users/example/project',
      prompt: 'hide this entire request',
      tool_name: 'Edit',
      file_path: 'src/users.ts',
    })

    expect(event.source).toBe('codex')
    expect(event.normalizedType).toBe('session.started')
    expect(event.externalSessionId).toBe('sess-1')
    expect(event.payload.prompt).toBeUndefined()
    expect(event.payload.toolName).toBe('Edit')
    expect(event.attributionConfidence).toBe('verified')
    expect(event.schemaVersion).toBe(1)
  })

  it('treats git events as inferred and Claude desktop as reported', () => {
    expect(
      projectInboundEvent({
        source: 'git',
        nativeEventType: 'git.status',
      }).attributionConfidence,
    ).toBe('inferred')
    expect(
      projectInboundEvent({
        source: 'claude-desktop',
        nativeEventType: 'sikumi.begin_work',
      }).attributionConfidence,
    ).toBe('reported')
  })

  it('builds a stable idempotency key', () => {
    const first = buildIdempotencyKey({
      source: 'cursor',
      externalSessionId: 's1',
      nativeEventType: 'afterFileEdit',
      toolUseId: 't1',
      occurredAt: '2026-08-18T00:00:00.000Z',
      resourcePath: 'src/a.ts',
    })
    const second = buildIdempotencyKey({
      source: 'cursor',
      externalSessionId: 's1',
      nativeEventType: 'afterFileEdit',
      toolUseId: 't1',
      occurredAt: '2026-08-18T00:00:00.000Z',
      resourcePath: 'src/a.ts',
    })
    expect(first).toBe(second)
    expect(first).toHaveLength(64)
  })

  it('rejects non-objects', () => {
    expect(() => projectInboundEvent('nope')).toThrow(AppError)
  })
})

describe('observer datetime', () => {
  it('accepts RFC3339 offsets and normalizes to ISO UTC', () => {
    expect(normalizeObserverDateTime('2026-08-18T09:00:00+09:00')).toBe(
      '2026-08-18T00:00:00.000Z',
    )
    expect(normalizeObserverDateTime('2026-08-18T00:00:00.000Z')).toBe(
      '2026-08-18T00:00:00.000Z',
    )
    expect(isObserverDateTime('2026-08-18T00:00:00Z')).toBe(true)
  })

  it('rejects date-only, spaced, and malformed timestamps', () => {
    expect(normalizeObserverDateTime('2026-08-18')).toBeNull()
    expect(normalizeObserverDateTime('2026-08-18 00:00:00')).toBeNull()
    expect(normalizeObserverDateTime('not-a-date')).toBeNull()
    expect(normalizeObserverDateTime('2026-13-40T99:99:99Z')).toBeNull()
    expect(inboundObserverEventSchema.safeParse({
      source: 'codex',
      occurredAt: 'not-a-date-value',
    }).success).toBe(false)
    expect(() =>
      projectInboundEvent({
        source: 'codex',
        nativeEventType: 'heartbeat',
        timestamp: 'yesterday',
      }),
    ).toThrow(AppError)
  })
})

describe('hook metadata helpers', () => {
  it('classifies commands without keeping the full text', () => {
    expect(classifyCommandCategory('pnpm test')).toBe('test')
    expect(classifyCommandCategory('git status')).toBe('git')
    expect(classifyCommandCategory('npm install')).toBe('install')
    expect(classifyCommandCategory('')).toBe('unknown')
  })

  it('extracts apply_patch and Edit paths and drops traversal', () => {
    expect(
      extractApplyPatchPaths('*** Update File: src/auth/session.ts\n@@\n'),
    ).toEqual(['src/auth/session.ts'])
    expect(
      extractToolFilePaths({
        toolName: 'Edit',
        toolInput: { file_path: 'src/users.ts', old_string: 'secret' },
      }),
    ).toEqual(['src/users.ts'])
    expect(
      extractToolFilePaths({
        toolName: 'Write',
        toolInput: { file_path: '../etc/passwd' },
      }),
    ).toEqual([])
    expect(toSafeHookCommand('/tmp/sikumi-observer-codex.mjs')).toBe(
      '/tmp/sikumi-observer-codex.mjs',
    )
    expect(toSafeHookCommand('/tmp/my project/sikumi-observer-codex.mjs')).toBe(
      '/tmp/my project/sikumi-observer-codex.mjs',
    )
    expect(toSafeHookCommand('/tmp/hook; rm -rf /')).toBeNull()
    expect(isRealUserHomePath('/tmp/sandbox-home')).toBe(false)
  })

  it('keeps command category instead of bash text when projecting', () => {
    const event = projectInboundEvent({
      source: 'codex',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test --filter observer' },
      prompt: 'hidden',
    })
    expect(event.payload.commandCategory).toBe('test')
    expect(event.payload.commandName).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('pnpm test --filter observer')
  })
})

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'observer-core-'))
  tempDirectories.push(directory)
  return directory
}

describe('install confirmation and observed health', () => {
  it('rejects public homeDir, repoDir, allowRealUserApply, and env fields', () => {
    expect(
      observerAdapterActionRequestSchema.safeParse({ homeDir: '/tmp/x' }).success,
    ).toBe(false)
    expect(
      observerAdapterActionRequestSchema.safeParse({ repoDir: '/tmp/x' }).success,
    ).toBe(false)
    expect(
      observerAdapterActionRequestSchema.safeParse({ allowRealUserApply: true }).success,
    ).toBe(false)
    expect(
      observerAdapterActionRequestSchema.safeParse({ env: { HOME: '/tmp/x' } }).success,
    ).toBe(false)
    expect(observerAdapterActionRequestSchema.safeParse({ confirm: false }).success).toBe(
      true,
    )
  })

  it('grants real-user apply only after confirm and a matching plan digest', () => {
    const preview = attachInstallPlanIdentity(
      {
        ok: true,
        changed: false,
        message: 'preview',
        files: [],
      },
      '/tmp/preview-root',
    )
    expect(preview.planDigest).toBeTruthy()
    const digest = preview.planDigest as string
    expect(
      shouldGrantRealUserApply({ confirm: false, planDigest: digest }, preview),
    ).toBe(false)
    expect(
      shouldGrantRealUserApply({ confirm: true, planDigest: 'wrong' }, preview),
    ).toBe(false)
    expect(
      shouldGrantRealUserApply(
        { confirm: true, planDigest: digest, confirmationToken: digest },
        preview,
      ),
    ).toBe(true)
  })

  it('applies to an injected real home only when the unpublished allow flag is set', () => {
    const home = createTemp()
    const target = join(home, '.codex', 'hooks.json')
    const env = { HOME: home }
    const plan = attachInstallPlanIdentity(
      {
        ok: true,
        changed: false,
        message: 'preview',
        files: [{ path: target, action: 'create', preview: '{}\n' }],
      },
      home,
    )
    expect(plan.planDigest).toBeTruthy()
    const digest = plan.planDigest as string
    const blocked = applyConfirmedInstallPlan(
      plan,
      {
        confirm: true,
        confirmationToken: digest,
        planDigest: digest,
        env,
      },
      {
        targetRoot: home,
        relativeSegments: ['.codex', 'hooks.json'],
        successMessage: 'wrote',
        env,
      },
    )
    expect(blocked.ok).toBe(false)
    expect(blocked.applied).toBe(false)
    expect(existsSync(target)).toBe(false)

    const stale = applyConfirmedInstallPlan(
      plan,
      {
        confirm: true,
        allowRealUserApply: true,
        confirmationToken: 'stale-digest',
        env,
      },
      {
        targetRoot: home,
        relativeSegments: ['.codex', 'hooks.json'],
        successMessage: 'wrote',
        env,
      },
    )
    expect(stale.ok).toBe(false)
    expect(stale.message).toBe(INSTALL_PLAN_DIGEST_MISMATCH_MESSAGE)
    expect(existsSync(target)).toBe(false)

    const allowed = applyConfirmedInstallPlan(
      plan,
      {
        confirm: true,
        allowRealUserApply: true,
        confirmationToken: digest,
        planDigest: digest,
        env,
      },
      {
        targetRoot: home,
        relativeSegments: ['.codex', 'hooks.json'],
        successMessage: 'wrote',
        env,
      },
    )
    expect(allowed.applied).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('{}\n')
  })

  it('promotes needs_review only after an observed hook event', () => {
    const pending = unavailableHealth({
      status: 'needs_review',
      errors: [],
      warnings: ['設定は見つかりましたが、Sikumiがhook eventを受信した記録はありません'],
    })
    expect(rememberAdapterObservation(pending).status).toBe('needs_review')
    const ready = rememberAdapterObservation(pending, '2026-08-18T00:00:00.000Z')
    expect(ready.status).toBe('ready')
    expect(ready.lastEventAt).toBe('2026-08-18T00:00:00.000Z')
    expect(rememberAdapterObservation(unavailableHealth(), '2026-08-18T00:00:00.000Z').status).toBe(
      'not_installed',
    )
    const cooperative = rememberAdapterObservation(
      unavailableHealth({
        status: 'needs_review',
        errors: [],
        warnings: ['パッケージはありますが、Sikumiが協調報告を受信した記録はありません'],
      }),
      '2026-08-18T00:00:00.000Z',
    )
    expect(cooperative.status).toBe('ready')
    expect(cooperative.warnings).toContain('Sikumiが協調報告を受信済みです')
  })
})

describe('deferred adapters', () => {
  it('exposes extension points without installing anything', async () => {
    const adapters = defaultObserverAdapters()
    expect(adapters.map((adapter) => adapter.id)).toEqual([
      'codex',
      'cursor',
      'grok-build',
      'claude-code',
      'claude-desktop',
    ])
    const cursor = adapters.find((adapter) => adapter.id === 'cursor')
    expect(cursor?.normalize({})).toBeNull()
    const health = await cursor?.healthCheck()
    expect(health?.ok).toBe(false)
    const installed = await cursor?.install()
    expect(installed?.changed).toBe(false)
    expect(inferNormalizedType('afterFileEdit')).toBe('file.changed')
    expect(() => assertInstallNotImplemented()).toThrow(AppError)
    const deferred = createDeferredObserverAdapter({
      id: 'grok-build',
      capabilities: cursor!.capabilities,
    })
    expect((await deferred.uninstall()).ok).toBe(false)
    expect(
      projectInboundEvent({
        source: 'cursor',
        surface: 'cursor-tab',
        nativeEventType: 'afterTabFileEdit',
      }).surface,
    ).toBe('cursor-tab')
  })
})

describe('version probe', () => {
  it('parses a range and never keeps probe output beyond the version', async () => {
    expect(parseSemver('grok 1.4.2 (build abc)')).toBe('1.4.2')
    expect(
      classifyObservedVersion('1.4.2', {
        min: '1.0.0',
        max: '1.99.99',
        label: '1.x',
      }),
    ).toBe('supported')
    expect(
      classifyObservedVersion('2.0.0', {
        min: '1.0.0',
        max: '1.99.99',
        label: '1.x',
      }),
    ).toBe('needs_update')
    expect(
      classifyObservedVersion(null, {
        min: '1.0.0',
        max: '1.99.99',
        label: '1.x',
      }),
    ).toBe('unknown')

    const bin = createTemp()
    writeFileSync(
      join(bin, 'grok'),
      '#!/usr/bin/env node\nconsole.log("1.8.0 token=sk-live-secret-value")\n',
    )
    chmodSync(join(bin, 'grok'), 0o755)
    const probed = await probeCommandVersion({
      names: ['grok'],
      env: { PATH: bin, HOME: bin },
    })
    expect(probed.version).toBe('1.8.0')
    expect(JSON.stringify(probed)).not.toContain('sk-live-secret-value')
  })
})

describe('cursor tab aggregation', () => {
  it('groups tab sessions by time window, repo, and path', () => {
    const now = Date.parse('2026-08-18T00:10:00.000Z')
    const result = aggregateCursorTabSessions({
      now,
      sessions: [
        {
          id: 'agent-1',
          source: 'cursor',
          surface: 'cursor-agent',
          externalSessionId: 'conv-1',
          workspaceId: null,
          repositoryId: 'repo-a',
          cwd: '/tmp/repo',
          worktreePath: '/tmp/repo',
          branch: 'main',
          baseCommit: null,
          headCommit: null,
          title: 'Agent',
          status: 'active',
          activity: 'editing',
          attributionConfidence: 'verified',
          startedAt: '2026-08-18T00:00:00.000Z',
          lastObservedAt: '2026-08-18T00:09:00.000Z',
          endedAt: null,
        },
        {
          id: 'tab-1',
          source: 'cursor',
          surface: 'cursor-tab',
          externalSessionId: 'tab:/tmp/repo',
          workspaceId: null,
          repositoryId: 'repo-a',
          cwd: '/tmp/repo',
          worktreePath: '/tmp/repo',
          branch: 'main',
          baseCommit: null,
          headCommit: null,
          title: 'tab a',
          status: 'active',
          activity: 'editing',
          attributionConfidence: 'verified',
          startedAt: '2026-08-18T00:08:00.000Z',
          lastObservedAt: '2026-08-18T00:09:30.000Z',
          endedAt: null,
        },
        {
          id: 'tab-2',
          source: 'cursor',
          surface: 'cursor-tab',
          externalSessionId: 'tab:/tmp/repo-b',
          workspaceId: null,
          repositoryId: 'repo-a',
          cwd: '/tmp/repo',
          worktreePath: '/tmp/repo',
          branch: 'main',
          baseCommit: null,
          headCommit: null,
          title: 'tab b',
          status: 'active',
          activity: 'editing',
          attributionConfidence: 'verified',
          startedAt: '2026-08-18T00:08:10.000Z',
          lastObservedAt: '2026-08-18T00:09:40.000Z',
          endedAt: null,
        },
      ],
      claims: [
        {
          id: 'c1',
          externalSessionId: 'tab-1',
          repositoryId: 'repo-a',
          resourceType: 'file',
          resourceKey: 'src/a.ts',
          action: 'write',
          claimKind: 'observed',
          confidence: 'verified',
          firstObservedAt: '2026-08-18T00:08:00.000Z',
          lastObservedAt: '2026-08-18T00:09:30.000Z',
        },
        {
          id: 'c2',
          externalSessionId: 'tab-2',
          repositoryId: 'repo-a',
          resourceType: 'file',
          resourceKey: 'src/b.ts',
          action: 'write',
          claimKind: 'observed',
          confidence: 'verified',
          firstObservedAt: '2026-08-18T00:08:10.000Z',
          lastObservedAt: '2026-08-18T00:09:40.000Z',
        },
      ],
    })
    expect(result.keep).toHaveLength(1)
    expect(result.keep[0]?.surface).toBe('cursor-agent')
    expect(result.groups).toHaveLength(2)
    expect(result.summarySession?.title).toContain('ほか 1 件')
    expect(result.summarySession?.surface).toBe('cursor-tab')
  })
})
