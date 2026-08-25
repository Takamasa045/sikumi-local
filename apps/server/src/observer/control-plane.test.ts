import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { controlPlaneSnapshotSchema } from '@sikumi-local/observer-core'
import { buildApp } from '../app.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { injectAuthed, injectPublic } from '../test/http.js'
import { buildControlPlaneSnapshot } from './control-plane.js'
import {
  adapter,
  claim,
  finding,
  NOW_ISO,
  NOW_MS,
  session,
  STALE_ISO,
} from './control-plane-fixtures.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('buildControlPlaneSnapshot', () => {
  it('returns one snapshot for 1 agent / 2 agents / waiting / stale / unknown / conflict / degraded', () => {
    const snapshot = buildControlPlaneSnapshot({
      generatedAt: NOW_ISO,
      now: NOW_MS,
      repositories: [
        { id: 'repo-a', displayName: 'alpha' },
        { id: 'repo-b', displayName: 'beta' },
      ],
      sessions: [
        session({ id: 'codex-a', source: 'codex' }),
        session({
          id: 'cursor-a',
          source: 'cursor',
          surface: 'cursor-agent',
        }),
        session({
          id: 'codex-wait',
          source: 'codex',
          status: 'waiting-for-user',
          activity: 'waiting-for-user',
          lastObservedAt: '2026-08-25T02:58:00.000Z',
          title: '確認してほしい',
        }),
        session({
          id: 'codex-stale',
          source: 'codex',
          status: 'stale',
          activity: 'idle',
          lastObservedAt: STALE_ISO,
          title: '古い直し',
        }),
        session({
          id: 'git-b',
          source: 'git',
          repositoryId: 'repo-b',
          attributionConfidence: 'inferred',
        }),
      ],
      claims: [
        claim('codex-a', 'src/auth.ts'),
        claim('cursor-a', 'src/auth.ts'),
        claim('codex-stale', 'src/old.ts', STALE_ISO),
      ],
      conflicts: [
        finding({
          id: 'same-file',
          level: 'high',
          leftSessionId: 'codex-a',
          rightSessionId: 'cursor-a',
        }),
      ],
      adapters: [adapter({ source: 'grok-build', status: 'degraded' })],
      git: [
        {
          repositoryId: 'repo-a',
          available: true,
          changedFileCount: 2,
          changedPaths: ['src/auth.ts', 'src/old.ts'],
          scannedAt: NOW_ISO,
        },
        {
          repositoryId: 'repo-b',
          available: true,
          changedFileCount: 1,
          changedPaths: ['README.md'],
          scannedAt: NOW_ISO,
        },
      ],
    })

    expect(controlPlaneSnapshotSchema.parse(snapshot).recommendations).toEqual(
      [],
    )
    expect(snapshot.works.map((item) => item.displayName)).toEqual(
      expect.arrayContaining(['Codex', 'Cursor Agent']),
    )
    expect(snapshot.works.some((item) => item.source === 'git')).toBe(false)
    expect(snapshot.repositories).toHaveLength(2)
    expect(snapshot.repositories[0]?.works.length).toBeGreaterThan(0)
    expect(
      snapshot.attention.some((item) => item.kind === 'waiting-for-user'),
    ).toBe(true)
    expect(snapshot.attention.some((item) => item.kind === 'stale-work')).toBe(
      true,
    )
    expect(
      snapshot.attention.find((item) => item.kind === 'stale-work')?.severity,
    ).toBe('yellow')
    expect(
      snapshot.attention.some(
        (item) => item.kind === 'conflict' && item.severity === 'red',
      ),
    ).toBe(true)
    expect(
      snapshot.attention.some((item) => item.kind === 'observer-degraded'),
    ).toBe(true)
    expect(snapshot.observer.ok).toBe(false)
    expect(snapshot.observer.degradedCount).toBe(1)
    expect(
      snapshot.repositories
        .find((item) => item.repositoryId === 'repo-b')
        ?.attention.some((item) => item.kind === 'unknown-owner'),
    ).toBe(true)
  })

  it('does not create red attention for two agents in the same repo without evidenced writes', () => {
    const snapshot = buildControlPlaneSnapshot({
      generatedAt: NOW_ISO,
      now: NOW_MS,
      repositories: [{ id: 'repo-a', displayName: 'alpha' }],
      sessions: [
        session({ id: 'codex-a', source: 'codex' }),
        session({ id: 'cursor-a', source: 'cursor' }),
      ],
      conflicts: [],
    })
    expect(snapshot.works).toHaveLength(2)
    expect(snapshot.attention.some((item) => item.severity === 'red')).toBe(
      false,
    )
    expect(snapshot.repositories[0]?.conflictCount).toBe(0)
  })
})

describe('GET /api/observer/control-plane', () => {
  it('returns who is working where, waiting, stale, conflicts, health, and confidence', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repoA = track(createTemporaryGitRepository())
    const repoB = track(createTemporaryGitRepository())
    mkdirSync(join(repoA, 'src'), { recursive: true })
    writeFileSync(join(repoA, 'src/auth.ts'), 'export const n = 1\n')
    const app = createApp(dataDirectory)

    const createdA = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repoA },
    })
    const createdB = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repoB },
    })
    expect(createdA.statusCode).toBe(201)
    expect(createdB.statusCode).toBe(201)

    const first = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        nativeEventType: 'SessionStart',
        session_id: 'http-codex',
        cwd: repoA,
        summary: 'ログイン画面の直し',
        occurredAt: '2026-08-25T02:58:00.000Z',
      },
    })
    const second = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'cursor',
        nativeEventType: 'sessionStart',
        session_id: 'http-cursor',
        cwd: repoA,
        surface: 'cursor-agent',
        summary: '同じ場所の別仕事',
        occurredAt: '2026-08-25T02:59:00.000Z',
      },
    })
    const other = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'claude-code',
        nativeEventType: 'SessionStart',
        session_id: 'http-claude',
        cwd: repoB,
        summary: '別の場所の調査',
        occurredAt: '2026-08-25T02:57:00.000Z',
      },
    })
    expect([first.statusCode, second.statusCode, other.statusCode]).toEqual([
      201, 201, 201,
    ])

    const waiting = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        nativeEventType: 'PermissionRequest',
        session_id: 'http-codex',
        cwd: repoA,
        occurredAt: '2026-08-25T03:00:00.000Z',
      },
    })
    expect(waiting.statusCode).toBe(201)

    const response = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/control-plane',
    })
    expect(response.statusCode).toBe(200)
    const snapshot = controlPlaneSnapshotSchema.parse(response.json().snapshot)
    expect(snapshot.recommendations).toEqual([])
    expect(snapshot.works.map((item) => item.source).sort()).toEqual([
      'claude-code',
      'codex',
      'cursor',
    ])
    expect(snapshot.repositories).toHaveLength(2)
    expect(
      snapshot.works.filter(
        (item) => item.repositoryId === snapshot.repositories[0]?.repositoryId,
      ).length +
        snapshot.works.filter(
          (item) =>
            item.repositoryId === snapshot.repositories[1]?.repositoryId,
        ).length,
    ).toBe(snapshot.works.length)
    expect(
      snapshot.attention.some((item) => item.kind === 'waiting-for-user'),
    ).toBe(true)
    expect(snapshot.works.every((item) => item.attributionConfidence)).toBe(
      true,
    )
    expect(snapshot.observer).toEqual(
      expect.objectContaining({
        ok: expect.any(Boolean),
        degradedCount: expect.any(Number),
      }),
    )
    expect(snapshot.works.some((item) => item.source === 'git')).toBe(false)
  })

  it('acknowledges attention without operating an agent', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repoA = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory)
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repoA },
    })
    expect(created.statusCode).toBe(201)

    const waiting = await injectAuthed(app, {
      method: 'POST',
      url: '/api/observer/events',
      payload: {
        source: 'codex',
        nativeEventType: 'PermissionRequest',
        session_id: 'http-codex',
        cwd: repoA,
        summary: '確認してほしい',
        occurredAt: '2026-08-25T03:00:00.000Z',
      },
    })
    expect(waiting.statusCode).toBe(201)

    const before = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/control-plane',
    })
    const snapshot = controlPlaneSnapshotSchema.parse(before.json().snapshot)
    const item = snapshot.attention.find(
      (entry) => entry.kind === 'waiting-for-user',
    )
    expect(item).toBeDefined()

    const acked = await injectAuthed(app, {
      method: 'POST',
      url: `/api/observer/attention/${encodeURIComponent(item!.id)}/acknowledge`,
      payload: {},
    })
    expect(acked.statusCode).toBe(200)
    expect(acked.json().attention.id).toBe(item!.id)

    const after = await injectPublic(app, {
      method: 'GET',
      url: '/api/observer/control-plane',
    })
    const next = controlPlaneSnapshotSchema.parse(after.json().snapshot)
    expect(next.attention.some((entry) => entry.id === item!.id)).toBe(false)
  })
})

function createApp(dataDirectory: string) {
  const app = buildApp({
    dataDirectory,
    observerScanThrottleMs: 0,
    observerScanDebounceMs: 0,
  })
  apps.push(app)
  return app
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
