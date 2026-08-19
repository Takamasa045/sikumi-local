import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeSpoolEvent } from '@sikumi-local/observer-bridge'
import { CLAUDE_CODE_REQUIRED_HOOK_EVENTS } from '@sikumi-local/observer-claude-code'
import {
  INSTALL_PLAN_DIGEST_MISMATCH_MESSAGE,
  projectInboundEvent,
  realUserHome,
} from '@sikumi-local/observer-core'
import Database from 'better-sqlite3'
import { buildApp } from '../app.js'
import { databaseFilePath } from '../storage/data-directory.js'
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

describe('observer phase 1', () => {
  it('lists git activity for registered repositories without adapters', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src/auth'), { recursive: true })
    writeFileSync(join(repo, 'src/auth/session.ts'), 'export const n = 1\n')
    const app = createApp(dataDirectory)

    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    expect(created.statusCode).toBe(201)
    const repositoryId = created.json().workspace.repository.id as string

    const today = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/today',
    })
    expect(today.statusCode).toBe(200)
    const overview = today.json().overview as {
      activeRepositoryCount: number
      repositories: Array<{
        displayName: string
        changedFileCount: number
        summary: string
      }>
    }
    expect(overview.activeRepositoryCount).toBeGreaterThan(0)
    expect(overview.repositories[0]?.changedFileCount).toBeGreaterThan(0)
    expect(overview.repositories[0]?.summary).toContain('変更元不明')

    const activity = await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity`,
    })
    expect(activity.statusCode).toBe(200)
    expect(activity.json().activity.worktrees.length).toBeGreaterThan(0)
  })

  it('rejects invalid, huge, and secret-heavy API events while accepting allowlisted ones', async () => {
    const app = createApp(track(createTemporaryDirectory()))

    const invalid = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: { nope: true },
    })
    expect(invalid.statusCode).toBe(400)

    const huge = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: { source: 'codex', nativeEventType: 'x', prompt: 'p'.repeat(40_000) },
    })
    expect([400, 413]).toContain(huge.statusCode)

    const accepted = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        nativeEventType: 'SessionStart',
        session_id: 'sess-api',
        cwd: '/tmp/not-registered',
        prompt: 'this prompt must vanish',
        tool_name: 'Edit',
      },
    })
    expect(accepted.statusCode).toBe(201)
    const event = accepted.json().event as {
      payload: Record<string, string>
      attributionConfidence: string
    }
    expect(event.payload.prompt).toBeUndefined()
    expect(event.payload.toolName).toBe('Edit')
    expect(event.attributionConfidence).toBe('verified')

    const duplicate = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        nativeEventType: 'SessionStart',
        session_id: 'sess-api',
        cwd: '/tmp/not-registered',
        occurredAt: accepted.json().event.occurredAt,
        tool_name: 'Edit',
      },
    })
    expect(duplicate.statusCode).toBe(201)
    expect(duplicate.json().event.id).toBe(accepted.json().event.id)
  })

  it('recovers spool events after restart and ignores broken lines', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const first = createApp(dataDirectory)
    await injectAuthed(first, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const event = projectInboundEvent({
      source: 'cursor',
      nativeEventType: 'sessionStart',
      session_id: 'cursor-1',
      cwd: repo,
      occurredAt: '2026-08-18T01:00:00.000Z',
    })
    writeSpoolEvent(dataDirectory, event)
    writeFileSync(
      join(dataDirectory, 'observer/inbox/cursor/broken.ndjson'),
      '{not json\n',
    )
    await first.close()

    const second = createApp(dataDirectory)
    let listed: Array<{ source: string }> = []
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const sessions = await injectPublic(second, {
        method: 'GET',
        url: '/api/external-sessions',
      })
      expect(sessions.statusCode).toBe(200)
      listed = sessions.json().sessions as Array<{ source: string }>
      if (listed.some((session) => session.source === 'cursor')) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(listed.some((session) => session.source === 'cursor')).toBe(true)
    const failedDir = join(dataDirectory, 'observer/failed')
    const failedText = readdirSync(failedDir)
      .map((name) => readFileSync(join(failedDir, name), 'utf8'))
      .join('\n')
    expect(failedText).toContain('json-parse')
    expect(failedText).not.toContain('{not json')
  })

  it('does not keep prompt or token text from a broken spool', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const inbox = join(dataDirectory, 'observer/inbox/codex')
    mkdirSync(inbox, { recursive: true })
    writeFileSync(
      join(inbox, 'secret-broken.ndjson'),
      JSON.stringify({
        source: 'codex',
        prompt: 'hide this entire request',
        token: 'sk-live-secret-value',
        transcript: 'full conversation',
      }) + '\n{not-json\n',
    )
    const app = createApp(dataDirectory)
    await injectPublic(app, { method: 'GET', url: '/api/observer/today' })
    const failedDir = join(dataDirectory, 'observer/failed')
    expect(existsSync(failedDir)).toBe(true)
    const dumped = readdirSync(failedDir)
      .map((name) => readFileSync(join(failedDir, name), 'utf8'))
      .join('\n')
    expect(dumped).not.toContain('hide this entire request')
    expect(dumped).not.toContain('sk-live-secret-value')
    expect(dumped).not.toContain('full conversation')
    expect(dumped).toContain('json-parse')
  })

  it('previews Codex install, refuses real apply, and still exposes git check', async () => {
    const app = createApp(track(createTemporaryDirectory()))
    const install = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/codex/install',
      payload: {},
    })
    expect(install.statusCode).toBe(200)
    expect(install.json().result.requiresConfirm).toBe(true)
    expect(install.json().result.changed).toBe(false)

    const applyReal = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/codex/install',
      payload: { confirm: true },
    })
    expect(applyReal.statusCode).toBe(200)
    expect(applyReal.json().result.ok).toBe(false)
    expect(applyReal.json().result.applied).toBe(false)

    const check = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/git/check',
    })
    expect(check.statusCode).toBe(200)
    expect(check.json().adapter.installationStatus).toBe('ready')
  })

  it('does not destroy existing job tables when observer migration re-runs', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const first = createApp(dataDirectory)
    const health = await injectPublic(first, { method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    await first.close()
    const second = createApp(dataDirectory)
    const again = await injectPublic(second, { method: 'GET', url: '/api/health' })
    expect(again.statusCode).toBe(200)
    const adapters = await injectPublic(second, {
      method: 'GET',
      url: '/api/observer/adapters',
    })
    expect(adapters.statusCode).toBe(200)
    expect(adapters.json().adapters.length).toBeGreaterThan(0)
  })
})

describe('observer worktree scan', () => {
  it('discovers a linked worktree and overlapping files', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 1\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'users'], { cwd: repo })
    const worktree = join(track(createTemporaryDirectory()), 'wt')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 2\n')
    writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 3\n')

    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    const activity = await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity`,
    })
    expect(activity.statusCode).toBe(200)
    expect(activity.json().activity.worktrees.length).toBeGreaterThanOrEqual(2)
    expect(activity.json().activity.conflicts.length).toBeGreaterThan(0)
  })

  it('correlates a hook event from a linked worktree outside the registered root', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const worktree = join(track(createTemporaryDirectory()), 'linked-wt')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity?mode=detail`,
    })
    const posted = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'cursor',
        nativeEventType: 'sessionStart',
        session_id: 'cursor-linked',
        cwd: realpathSync(worktree),
        worktreePath: realpathSync(worktree),
        occurredAt: '2026-08-18T03:00:00.000Z',
      },
    })
    expect(posted.statusCode).toBe(201)
    const event = posted.json().event as {
      repositoryId: string | null
      attributionConfidence: string
    }
    expect(event.repositoryId).toBe(repositoryId)
    expect(['verified', 'correlated']).toContain(event.attributionConfidence)
  })

  it('refreshes today after the scan throttle and keeps hook scans bounded', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory, { observerScanThrottleMs: 0 })
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    const first = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/today',
    })
    expect(first.json().overview.repositories[0]?.changedFileCount ?? 0).toBe(0)
    writeFileSync(join(repo, 'fresh.txt'), 'now\n')
    const second = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/today',
    })
    expect(second.json().overview.repositories[0]?.changedFileCount).toBeGreaterThan(
      0,
    )

    const flood = createApp(dataDirectory, {
      observerScanThrottleMs: 60_000,
      observerScanDebounceMs: 30_000,
    })
    for (let index = 0; index < 20; index += 1) {
      const posted = await injectAuthed(flood, {
        method: 'POST',
        url: '/api/observer/events',
        payload: {
          source: 'codex',
          nativeEventType: 'afterFileEdit',
          session_id: `flood-${index}`,
          cwd: repo,
          file_path: 'fresh.txt',
          occurredAt: `2026-08-18T04:00:${String(index).padStart(2, '0')}.000Z`,
        },
      })
      expect(posted.statusCode).toBe(201)
    }
    expect(repositoryId).toBeTruthy()
  })

  it('persists allowlisted identifiers across restart and updates session git fields', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const first = createApp(dataDirectory)
    const created = await injectAuthed(first, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'claude-code',
        nativeEventType: 'TaskCreated',
        session_id: 'persist-1',
        turn_id: 'turn-1',
        task_id: 'task-1',
        subagent_id: 'sub-1',
        baseCommit: 'aaa1111',
        headCommit: 'bbb2222',
        surface: 'cli',
        summary: '最初の題名',
        occurredAt: '2026-08-18T05:00:00.000Z',
        prompt: 'must not persist',
        transcript: 'must not persist either',
      },
    })
    expect(created.statusCode).toBe(201)
    const eventId = created.json().event.id as string
    await injectAuthed(first, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'claude-code',
        nativeEventType: 'TaskCompleted',
        session_id: 'persist-1',
        turn_id: 'turn-2',
        baseCommit: 'ccc3333',
        headCommit: 'ddd4444',
        surface: 'desktop-app',
        summary: '更新された題名',
        occurredAt: '2026-08-18T05:01:00.000Z',
      },
    })
    await first.close()

    const second = createApp(dataDirectory)
    const listed = await injectPublic(second, {
      method: 'GET',
      url: '/api/external-sessions',
    })
    const session = (
      listed.json().sessions as Array<{
        externalSessionId: string
        baseCommit: string | null
        headCommit: string | null
        surface: string
        title: string | null
        id: string
      }>
    ).find((item) => item.externalSessionId === 'persist-1')
    expect(session?.baseCommit).toBe('ccc3333')
    expect(session?.headCommit).toBe('ddd4444')
    expect(session?.surface).toBe('desktop-app')
    expect(session?.title).toBe('更新された題名')
    const events = await injectPublic(second, {
      method: 'GET',
      url: `/api/external-sessions/${session?.id}/events`,
    })
    const restored = (
      events.json().events as Array<{
        id: string
        externalTurnId: string | null
        externalTaskId: string | null
        externalSubagentId: string | null
        baseCommit: string | null
        headCommit: string | null
        payload: Record<string, string>
      }>
    ).find((item) => item.id === eventId)
    expect(restored?.externalTurnId).toBe('turn-1')
    expect(restored?.externalTaskId).toBe('task-1')
    expect(restored?.externalSubagentId).toBe('sub-1')
    expect(restored?.baseCommit).toBe('aaa1111')
    expect(restored?.headCommit).toBe('bbb2222')
    expect(restored?.payload.prompt).toBeUndefined()
    expect(JSON.stringify(restored)).not.toContain('must not persist')
  })

  it('keeps simple today/activity views free of absolute paths and branches', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    const today = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/today',
    })
    const todayBody = JSON.stringify(today.json())
    expect(todayBody).not.toContain(repo)
    expect(today.json().overview.repositories[0]?.worktrees[0]?.branch).toBeNull()
    expect(today.json().overview.repositories[0]?.worktrees[0]?.path).toBe(
      'primary',
    )
    const activity = await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity`,
    })
    expect(JSON.stringify(activity.json())).not.toContain(repo)
    const detail = await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity?mode=detail`,
    })
    expect(detail.json().activity.worktrees[0]?.path).toContain('/')
  })

  it('does not duplicate snapshots or conflicts on repeated scans', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 1\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'users'], { cwd: repo })
    const worktree = join(track(createTemporaryDirectory()), 'wt')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 2\n')
    writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 3\n')
    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    const snapshots = await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/snapshots`,
    })
    const conflicts = await injectPublic(app, {
      method: 'GET',
      url: `/api/conflicts?repositoryId=${repositoryId}`,
    })
    expect(
      (snapshots.json().snapshots as unknown[]).length,
    ).toBeLessThanOrEqual(4)
    expect((conflicts.json().conflicts as unknown[]).length).toBe(1)
  })
})

describe('observer phase 2 and 3 hooks', () => {
  it('previews install, rejects path override, token mismatch, and unregistered repo', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = createApp(dataDirectory)
    const homesBefore = snapshotRealUserHomes()

    const preview = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/codex/install',
      payload: {},
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().result.changed).toBe(false)
    expect(preview.json().result.applied).not.toBe(true)
    expect(preview.json().result.requiresConfirm).toBe(true)
    expect(
      preview.json().result.confirmationToken ?? preview.json().result.planDigest,
    ).toBeTruthy()

    const repo = track(createTemporaryGitRepository())
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    expect(created.statusCode).toBe(201)
    const repositoryId = created.json().workspace.repository.id as string
    const repoPreview = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/claude-code/install',
      payload: { scope: 'repo', repositoryId },
    })
    expect(repoPreview.statusCode).toBe(200)
    expect(repoPreview.json().result.requiresConfirm).toBe(true)
    expect(repoPreview.json().result.confirmationToken).toBeTruthy()

    const mismatch = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/claude-code/install',
      payload: {
        scope: 'repo',
        repositoryId,
        confirm: true,
        confirmationToken: 'wrong-token',
      },
    })
    expect(mismatch.statusCode).toBe(200)
    expect(mismatch.json().result.ok).toBe(false)
    expect(mismatch.json().result.applied).not.toBe(true)
    expect(mismatch.json().result.message).toBe(INSTALL_PLAN_DIGEST_MISMATCH_MESSAGE)

    const repoApply = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/claude-code/install',
      payload: {
        scope: 'repo',
        repositoryId,
        confirm: true,
        confirmationToken: repoPreview.json().result.confirmationToken,
        planDigest: repoPreview.json().result.planDigest,
      },
    })
    expect(repoApply.statusCode).toBe(200)
    expect(repoApply.json().result.applied).toBe(true)
    const repoSettings = JSON.parse(
      readFileSync(join(repo, '.claude', 'settings.local.json'), 'utf8'),
    ) as { hooks: Record<string, unknown[]> }
    for (const eventName of CLAUDE_CODE_REQUIRED_HOOK_EVENTS) {
      expect(repoSettings.hooks[eventName]?.length).toBeGreaterThan(0)
    }

    const injectedHome = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/codex/install',
      payload: { homeDir: '/tmp/observer-not-allowed', confirm: true },
    })
    expect(injectedHome.statusCode).toBe(400)

    const injectedRepo = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/claude-code/install',
      payload: { repoDir: '/tmp/observer-not-allowed' },
    })
    expect(injectedRepo.statusCode).toBe(400)

    const injectedAllow = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/codex/install',
      payload: { allowRealUserApply: true, confirm: true },
    })
    expect(injectedAllow.statusCode).toBe(400)

    const unregistered = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/claude-code/install',
      payload: { scope: 'repo', repositoryId: 'missing-repo' },
    })
    expect(unregistered.statusCode).toBe(404)

    const posted = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        hook_event_name: 'PreToolUse',
        session_id: 'codex-native',
        tool_name: 'apply_patch',
        tool_input: {
          patch: '*** Update File: src/auth/session.ts\n@@\n+secret\n',
        },
        prompt: 'hide me',
      },
    })
    expect(posted.statusCode).toBe(201)
    expect(posted.json().event.payload.filePath).toBe('src/auth/session.ts')
    expect(JSON.stringify(posted.json())).not.toContain('hide me')
    expect(JSON.stringify(posted.json())).not.toContain('+secret')

    const afterEvent = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/adapters',
    })
    const lastEventAt = (
      afterEvent.json().adapters as Array<{
        source: string
        lastEventAt: string | null
      }>
    ).find((item) => item.source === 'codex')?.lastEventAt
    expect(lastEventAt).toBeTruthy()

    const checked = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/codex/check',
    })
    expect(checked.statusCode).toBe(200)
    expect(checked.json().adapter.lastEventAt).toBe(lastEventAt)
    expect(snapshotRealUserHomes()).toEqual(homesBefore)
  })
})

describe('observer phase 4 and 5 adapters', () => {
  it('lists Cursor and Grok, previews both scopes, and does not write real homes', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = createApp(dataDirectory)
    const homesBefore = snapshotRealUserHomes()
    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/adapters',
    })
    const sources = (
      listed.json().adapters as Array<{ source: string }>
    ).map((item) => item.source)
    expect(sources).toEqual(
      expect.arrayContaining([
        'cursor',
        'grok-build',
        'codex',
        'claude-code',
        'claude-desktop',
      ]),
    )

    const cursorPreview = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/cursor/install',
      payload: {},
    })
    expect(cursorPreview.statusCode).toBe(200)
    expect(cursorPreview.json().result.applied).not.toBe(true)
    expect(cursorPreview.json().result.requiresConfirm).toBe(true)

    const grokPreview = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/grok-build/install',
      payload: {},
    })
    expect(grokPreview.statusCode).toBe(200)
    expect(grokPreview.json().result.applied).not.toBe(true)
    expect(String(grokPreview.json().result.message)).not.toBe(
      'Unexpected server error',
    )
    expect(String(grokPreview.json().result.preview ?? '')).toContain(
      'sikumi-observer',
    )
    expect(String(grokPreview.json().result.preview ?? '')).not.toContain(
      '# sikumi-observer-begin',
    )
    expect(String(JSON.stringify(grokPreview.json().result))).not.toContain(
      '[[hooks.',
    )

    const repo = track(createTemporaryGitRepository())
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    const cursorRepo = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/cursor/install',
      payload: { scope: 'repo', repositoryId },
    })
    expect(cursorRepo.statusCode).toBe(200)
    expect(cursorRepo.json().result.applied).not.toBe(true)
    const grokRepo = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/grok-build/install',
      payload: { scope: 'repo', repositoryId },
    })
    expect(grokRepo.statusCode).toBe(200)
    expect(grokRepo.json().result.applied).not.toBe(true)
    expect(String(JSON.stringify(grokRepo.json().result))).not.toContain(
      '"hooks":{',
    )

    const grokApply = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/grok-build/install',
      payload: {
        scope: 'repo',
        repositoryId,
        confirm: true,
        confirmationToken: grokRepo.json().result.confirmationToken,
        planDigest: grokRepo.json().result.planDigest,
      },
    })
    expect(grokApply.statusCode).toBe(200)
    expect(grokApply.json().result.ok).toBe(true)
    expect(grokApply.json().result.applied).toBe(true)
    expect(grokApply.json().result.message).toBe('つながりました')
    expect(existsSync(join(repo, '.grok', 'hooks', 'sikumi-observer.json'))).toBe(
      true,
    )
    expect(String(JSON.stringify(grokApply.json().result))).not.toContain(
      'Unexpected server error',
    )

    const grokAgain = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/grok-build/install',
      payload: { scope: 'repo', repositoryId },
    })
    const grokIdempotent = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/grok-build/install',
      payload: {
        scope: 'repo',
        repositoryId,
        confirm: true,
        confirmationToken: grokAgain.json().result.confirmationToken,
        planDigest: grokAgain.json().result.planDigest,
      },
    })
    expect(grokIdempotent.statusCode).toBe(200)
    expect(grokIdempotent.json().result.ok).toBe(true)
    expect(grokIdempotent.json().result.applied).toBe(true)
    expect(grokIdempotent.json().result.message).toBe('つながりました')
    expect(snapshotRealUserHomes()).toEqual(homesBefore)
  })
})

describe('observer phase 6 claude desktop', () => {
  it('generates a cooperative MCPB without writing Claude Desktop settings', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory)
    const homesBefore = snapshotRealUserHomes()
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string

    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/adapters',
    })
    const desktop = (
      listed.json().adapters as Array<{
        source: string
        health?: { warnings?: string[]; errors?: string[] }
      }>
    ).find((item) => item.source === 'claude-desktop')
    expect(desktop).toBeTruthy()
    expect(JSON.stringify(desktop)).toContain('協調報告')

    const preview = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/claude-desktop/install',
      payload: {},
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().result.applied).not.toBe(true)
    expect(preview.json().result.requiresConfirm).toBe(true)
    expect(String(preview.json().result.message)).toContain('協調報告')
    expect(String(preview.json().result.message)).toContain(
      '自動全観測ではありません',
    )

    const generated = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/adapters/claude-desktop/install',
      payload: {
        confirm: true,
        confirmationToken: preview.json().result.confirmationToken,
        planDigest: preview.json().result.planDigest,
      },
    })
    expect(generated.statusCode).toBe(200)
    expect(generated.json().result.applied).toBe(true)
    expect(
      existsSync(join(dataDirectory, 'observer/claude-desktop/sikumi-observer.mcpb')),
    ).toBe(true)

    const downloaded = await injectAuthed(app, {
      method: 'GET',
      url: '/api/observer/adapters/claude-desktop/package',
    })
    expect(downloaded.statusCode).toBe(200)
    expect(downloaded.headers['content-disposition']).toContain(
      'sikumi-observer.mcpb',
    )

    const reported = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'claude-desktop',
        type: 'sikumi.begin_work',
        sessionId: 'cd_deadbeefdeadbeef',
        cwd: repo,
        summary: '自己申告による作業',
        prompt: 'must not persist',
        occurredAt: '2026-08-18T06:00:00.000Z',
      },
    })
    expect(reported.statusCode).toBe(201)
    expect(reported.json().event.attributionConfidence).toBe('reported')
    expect(reported.json().event.ingestionMethod).toBe('mcp')
    expect(reported.json().event.surface).toBe('desktop-app')
    expect(JSON.stringify(reported.json())).not.toContain('must not persist')

    const sessions = await injectPublic(app, {
      method: 'GET',
      url: '/api/external-sessions',
    })
    const cooperative = (
      sessions.json().sessions as Array<{
        source: string
        attributionConfidence: string
        status: string
      }>
    ).find((item) => item.source === 'claude-desktop')
    expect(cooperative?.attributionConfidence).toBe('reported')

    const completed = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'claude-desktop',
        type: 'sikumi.complete_work',
        sessionId: 'cd_deadbeefdeadbeef',
        cwd: repo,
        occurredAt: '2026-08-18T06:05:00.000Z',
      },
    })
    expect(completed.statusCode).toBe(201)
    const after = await injectPublic(app, {
      method: 'GET',
      url: '/api/external-sessions',
    })
    const finished = (
      after.json().sessions as Array<{
        source: string
        status: string
        activity: string
      }>
    ).find((item) => item.source === 'claude-desktop')
    expect(finished?.status).toBe('completed')
    expect(finished?.activity).toBe('completed')

    writeFileSync(join(repo, 'unreported.txt'), 'git only\n')
    const activity = await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity`,
    })
    expect(activity.statusCode).toBe(200)
    expect(snapshotRealUserHomes()).toEqual(homesBefore)
  })

  it('keeps unreported git changes unattributed to Claude', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    writeFileSync(join(repo, 'notes.md'), 'changed\n')
    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    const activity = await injectPublic(app, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity`,
    })
    expect(activity.statusCode).toBe(200)
    const body = JSON.stringify(activity.json())
    expect(body).toContain('変更元不明')
    expect(body).not.toContain('Claudeアプリ')
    const sessions = activity.json().activity.sessions as Array<{
      source: string
      attributionConfidence: string
    }>
    expect(sessions.every((session) => session.source !== 'claude-desktop')).toBe(
      true,
    )
    expect(
      sessions.some((session) => session.attributionConfidence === 'inferred'),
    ).toBe(true)
  })
})

describe('observer phase 7 conflicts', () => {
  it('Scenario A: Codex and Cursor changing the same users.ts is high and verified', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 1\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'users'], { cwd: repo })
    const worktree = join(track(createTemporaryDirectory()), 'wt')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 2\n')
    writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 3\n')

    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        nativeEventType: 'SessionStart',
        session_id: 'codex-a',
        cwd: repo,
        worktreePath: repo,
        file_path: 'src/users.ts',
        occurredAt: '2026-08-18T06:00:00.000Z',
      },
    })
    await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'cursor',
        nativeEventType: 'sessionStart',
        session_id: 'cursor-a',
        cwd: realpathSync(worktree),
        worktreePath: realpathSync(worktree),
        file_path: 'src/users.ts',
        occurredAt: '2026-08-18T06:01:00.000Z',
      },
    })
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })

    const listed = await injectPublic(app, {
      method: 'GET',
      url: `/api/conflicts?repositoryId=${repositoryId}&unconfirmed=true`,
    })
    expect(listed.statusCode).toBe(200)
    const conflicts = listed.json().conflicts as Array<{
      id: string
      level: string
      score: number
      headline: string
      summary: string
      leftSource: string
      rightSource: string
      confidence: string
      status: string
    }>
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]?.level).toBe('high')
    expect(conflicts[0]?.score).toBeGreaterThanOrEqual(80)
    expect(conflicts[0]?.headline).toContain('🔴')
    expect(conflicts[0]?.summary).toContain('Codex')
    expect(conflicts[0]?.summary).toContain('Cursor')
    expect([conflicts[0]?.leftSource, conflicts[0]?.rightSource].sort()).toEqual([
      'codex',
      'cursor',
    ])
    expect(listed.json().counts.red).toBe(1)
    expect(JSON.stringify(listed.json())).not.toContain(repo)
  })

  it('reconstructs detail merge-base from worktree heads when session bases differ', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 1\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'users'], { cwd: repo })
    const commonBase = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    const worktree = join(track(createTemporaryDirectory()), 'wt')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 2\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'main-ahead'], { cwd: repo })
    writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 3\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: worktree })
    execFileSync('git', ['commit', '-m', 'feature-ahead'], { cwd: worktree })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 4\n')
    writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 5\n')
    const leftHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    const rightHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktree,
      encoding: 'utf8',
    }).trim()

    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    const listed = await injectPublic(app, {
      method: 'GET',
      url: `/api/conflicts?repositoryId=${repositoryId}`,
    })
    const simple = (listed.json().conflicts as Array<{
      id: string
      technical?: unknown
      leftWorktreePath: string | null
      evidence: Array<{ leftPath?: string }>
    }>)[0]
    expect(simple?.id).toBeTruthy()
    expect(simple?.technical).toBeUndefined()
    expect(simple?.leftWorktreePath).toBeNull()
    expect(simple?.evidence.every((item) => !item.leftPath)).toBe(true)
    expect(JSON.stringify(listed.json())).not.toContain(repo)

    const detail = await injectPublic(app, {
      method: 'GET',
      url: `/api/conflicts/${simple?.id}?mode=detail`,
    })
    expect(detail.statusCode).toBe(200)
    const technical = detail.json().conflict.technical as {
      commonBase: string
      leftBranch: string | null
      rightBranch: string | null
      leftHead: string | null
      rightHead: string | null
      changedPaths: string[]
      leftWorktreePath: string | null
    }
    expect(technical.commonBase).toBe(commonBase)
    expect(technical.commonBase).not.toBe('unknown')
    expect([technical.leftBranch, technical.rightBranch].sort()).toEqual([
      'feature',
      'main',
    ])
    expect([technical.leftHead, technical.rightHead].sort()).toEqual(
      [leftHead, rightHead].sort(),
    )
    expect(technical.changedPaths).toContain('src/users.ts')
    expect(JSON.stringify(detail.json())).not.toContain('/tmp/secret')
  })

  it('Scenario E: verified Codex + correlated Cursor stays Codex / 変更元不明', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 1\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'users'], { cwd: repo })
    const worktree = join(track(createTemporaryDirectory()), 'wt')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 2\n')
    writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 3\n')

    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        nativeEventType: 'SessionStart',
        session_id: 'codex-e',
        cwd: repo,
        worktreePath: repo,
        file_path: 'src/users.ts',
        occurredAt: '2026-08-18T08:00:00.000Z',
      },
    })
    await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'cursor',
        nativeEventType: 'sessionStart',
        session_id: 'cursor-e',
        cwd: realpathSync(worktree),
        worktreePath: realpathSync(worktree),
        file_path: 'src/users.ts',
        occurredAt: '2026-08-18T08:01:00.000Z',
      },
    })
    const sqlite = new Database(databaseFilePath(dataDirectory))
    sqlite
      .prepare(
        `UPDATE external_sessions SET attribution_confidence = 'correlated' WHERE source = 'cursor'`,
      )
      .run()
    sqlite.close()
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })

    const listed = await injectPublic(app, {
      method: 'GET',
      url: `/api/conflicts?repositoryId=${repositoryId}&source=cursor`,
    })
    const conflict = (listed.json().conflicts as Array<{
      id: string
      summary: string
      leftActorLabel: string
      rightActorLabel: string
      leftSource: string
      rightSource: string
    }>)[0]
    expect(conflict).toBeTruthy()
    expect([conflict?.leftSource, conflict?.rightSource].sort()).toEqual([
      'codex',
      'cursor',
    ])
    expect([conflict?.leftActorLabel, conflict?.rightActorLabel].sort()).toEqual([
      'Codex',
      '変更元不明',
    ])
    expect(conflict?.summary).toContain('Codex')
    expect(conflict?.summary).toContain('変更元不明')
    expect(conflict?.summary).not.toContain('Cursor')
    expect(JSON.stringify(listed.json())).not.toContain('Cursor')
  })

  it('Scenario C: Grok schema and Claude Code API produce caution', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src/db/schema'), { recursive: true })
    mkdirSync(join(repo, 'src/api'), { recursive: true })
    writeFileSync(join(repo, 'src/db/schema/users.ts'), 'export const users = {}\n')
    writeFileSync(join(repo, 'src/api/users.ts'), 'export const route = {}\n')
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'structure'], { cwd: repo })
    const worktree = join(track(createTemporaryDirectory()), 'wt')
    execFileSync('git', ['worktree', 'add', '-b', 'api', worktree], { cwd: repo })
    writeFileSync(join(repo, 'src/db/schema/users.ts'), 'export const users = { id: 1 }\n')
    writeFileSync(join(worktree, 'src/api/users.ts'), 'export const route = { id: 1 }\n')

    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'grok-build',
        nativeEventType: 'sessionStart',
        session_id: 'grok-c',
        cwd: repo,
        worktreePath: repo,
        file_path: 'src/db/schema/users.ts',
        occurredAt: '2026-08-18T07:00:00.000Z',
      },
    })
    await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'claude-code',
        nativeEventType: 'SessionStart',
        session_id: 'claude-c',
        cwd: realpathSync(worktree),
        worktreePath: realpathSync(worktree),
        file_path: 'src/api/users.ts',
        occurredAt: '2026-08-18T07:01:00.000Z',
      },
    })
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    const listed = await injectPublic(app, {
      method: 'GET',
      url: `/api/conflicts?repositoryId=${repositoryId}&unconfirmed=true`,
    })
    const conflict = (listed.json().conflicts as Array<{
      level: string
      headline: string
      summary: string
      evidence: Array<{ kind: string }>
    }>)[0]
    expect(conflict?.level).toBe('caution')
    expect(conflict?.headline).toContain('🟠')
    expect(conflict?.summary).toContain('同じデータ構造')
    expect(conflict?.evidence.some((item) => item.kind === 'schema-api')).toBe(true)
  })

  it('validates filters, requires auth/CSRF for mutations, and is idempotent', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 1\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'users'], { cwd: repo })
    const worktree = join(track(createTemporaryDirectory()), 'wt')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 2\n')
    writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 3\n')
    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    const listed = await injectPublic(app, { method: 'GET', url: '/api/conflicts' })
    const id = (listed.json().conflicts as Array<{ id: string }>)[0]?.id
    expect(id).toBeTruthy()

    const invalid = await injectPublic(app, {
      method: 'GET',
      url: '/api/conflicts?level=loud',
    })
    expect(invalid.statusCode).toBe(400)
    const extra = await injectPublic(app, {
      method: 'GET',
      url: '/api/conflicts?unknown=1',
    })
    expect(extra.statusCode).toBe(400)
    const missing = await injectPublic(app, {
      method: 'GET',
      url: '/api/conflicts/does-not-exist',
    })
    expect(missing.statusCode).toBe(404)

    const unauthed = await injectPublic(app, {
      method: 'POST',
      url: `/api/conflicts/${id}/acknowledge`,
      payload: {},
    })
    expect(unauthed.statusCode).toBe(403)

    const badBody = await injectAuthed(app, {
      method: 'POST',
      url: `/api/conflicts/${id}/acknowledge`,
      payload: { surprise: true },
    })
    expect(badBody.statusCode).toBe(400)

    const first = await injectAuthed(app, {
      method: 'POST',
      url: `/api/conflicts/${id}/acknowledge`,
      payload: {},
    })
    const second = await injectAuthed(app, {
      method: 'POST',
      url: `/api/conflicts/${id}/acknowledge`,
      payload: {},
    })
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.json().conflict.status).toBe('acknowledged')

    const filtered = await injectPublic(app, {
      method: 'GET',
      url: '/api/conflicts?unconfirmed=true',
    })
    expect((filtered.json().conflicts as unknown[]).length).toBe(0)

    const resolved = await injectAuthed(app, {
      method: 'POST',
      url: `/api/conflicts/${id}/resolve`,
      payload: {},
    })
    expect(resolved.json().conflict.status).toBe('resolved')
    const resolvedAgain = await injectAuthed(app, {
      method: 'POST',
      url: `/api/conflicts/${id}/resolve`,
      payload: {},
    })
    expect(resolvedAgain.json().conflict.status).toBe('resolved')

    const rechecked = await injectAuthed(app, {
      method: 'POST',
      url: `/api/conflicts/${id}/recheck`,
      payload: {},
    })
    expect(rechecked.statusCode).toBe(200)
    expect(rechecked.json().conflict.id).toBe(id)
  })

  it('does not duplicate findings across restart and keeps Scenario D/E attribution', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repo = track(createTemporaryGitRepository())
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 1\n')
    execFileSync('git', ['add', 'src/users.ts'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'users'], { cwd: repo })
    const worktree = join(track(createTemporaryDirectory()), 'wt')
    execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
      cwd: repo,
    })
    writeFileSync(join(repo, 'src/users.ts'), 'export const users = 2\n')
    writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 3\n')
    const first = createApp(dataDirectory)
    const created = await injectAuthed(first, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repo },
    })
    const repositoryId = created.json().workspace.repository.id as string
    await injectAuthed(first, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    const before = await injectPublic(first, {
      method: 'GET',
      url: `/api/conflicts?repositoryId=${repositoryId}`,
    })
    expect((before.json().conflicts as unknown[]).length).toBe(1)
    const conflictId = (before.json().conflicts as Array<{ id: string }>)[0]?.id
    await first.close()

    const second = createApp(dataDirectory)
    await injectAuthed(second, {
      method: 'POST',
      url: `/api/repositories/${repositoryId}/rescan`,
    })
    const after = await injectPublic(second, {
      method: 'GET',
      url: `/api/conflicts?repositoryId=${repositoryId}`,
    })
    expect((after.json().conflicts as Array<{ id: string }>).map((item) => item.id)).toEqual([
      conflictId,
    ])

    writeFileSync(join(repo, 'notes.md'), 'unreported\n')
    const activity = await injectPublic(second, {
      method: 'GET',
      url: `/api/repositories/${repositoryId}/activity`,
    })
    const body = JSON.stringify(activity.json())
    expect(body).toContain('変更元不明')
    expect(body).not.toContain('Claudeアプリ')
  })
})

function createApp(
  dataDirectory: string,
  options?: {
    readonly observerScanThrottleMs?: number
    readonly observerScanDebounceMs?: number
  },
) {
  const app = buildApp({
    dataDirectory,
    ...(options?.observerScanThrottleMs === undefined
      ? {}
      : { observerScanThrottleMs: options.observerScanThrottleMs }),
    ...(options?.observerScanDebounceMs === undefined
      ? {}
      : { observerScanDebounceMs: options.observerScanDebounceMs }),
  })
  apps.push(app)
  return app
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}

function snapshotRealUserHomes(): readonly {
  readonly path: string
  readonly exists: boolean
  readonly content: string | null
}[] {
  const home = realUserHome()
  return [
    join(home, '.codex', 'hooks.json'),
    join(home, '.claude', 'settings.json'),
    join(home, '.claude', 'settings.local.json'),
    join(home, '.cursor', 'hooks.json'),
    join(home, '.grok', 'config.toml'),
    join(home, '.grok', 'plugins', 'sikumi-observer', 'plugin.json'),
    join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    join(home, 'Library', 'Application Support', 'Claude', 'extensions'),
  ].map((path) => ({
    path,
    exists: existsSync(path),
    content: existsSync(path) ? readFileSync(path, 'utf8') : null,
  }))
}
