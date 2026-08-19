import { describe, expect, it } from 'vitest'
import type { ExternalSession, ResourceClaim } from '@sikumi-local/observer-core'
import { buildRepositoryActivity } from './views.js'

describe('observer views', () => {
  it('aggregates Cursor Tab sessions on the top screen', () => {
    const activity = buildRepositoryActivity({
      repository: {
        id: 'repo-a',
        workspaceId: 'ws-a',
        absolutePath: '/tmp/repo',
        displayName: 'demo',
        currentBranch: 'main',
        readable: true,
      },
      snapshot: {
        available: true,
        reason: null,
        repositoryRoot: '/tmp/repo',
        displayName: 'demo',
        branch: 'main',
        headCommit: 'abc',
        baseCommit: null,
        worktrees: [],
        changedFiles: [],
        scannedAt: '2026-08-18T00:10:00.000Z',
        truncated: false,
      },
      sessions: [
        session({
          id: 'agent',
          surface: 'cursor-agent',
          title: '大きな変更',
          lastObservedAt: '2026-08-18T00:09:00.000Z',
        }),
        session({
          id: 'tab-1',
          surface: 'cursor-tab',
          title: 'tab a',
          lastObservedAt: '2026-08-18T00:09:30.000Z',
        }),
        session({
          id: 'tab-2',
          surface: 'cursor-tab',
          title: 'tab b',
          lastObservedAt: '2026-08-18T00:09:40.000Z',
        }),
      ],
      labels: {},
      conflicts: [],
      claims: [
        claim('tab-1', 'src/a.ts', '2026-08-18T00:09:30.000Z'),
        claim('tab-2', 'src/b.ts', '2026-08-18T00:09:40.000Z'),
      ],
    })
    expect(activity.sessions.map((item) => item.displayName)).toEqual([
      'Cursor Agent',
      'Cursor Tab',
    ])
    expect(activity.sessions[1]?.title).toContain('ほか 1 件')
  })
})

function session(
  input: Pick<ExternalSession, 'id' | 'surface' | 'title' | 'lastObservedAt'>,
): ExternalSession {
  return {
    id: input.id,
    source: 'cursor',
    surface: input.surface,
    externalSessionId: input.id,
    workspaceId: 'ws-a',
    repositoryId: 'repo-a',
    cwd: '/tmp/repo',
    worktreePath: '/tmp/repo',
    branch: 'main',
    baseCommit: null,
    headCommit: null,
    title: input.title,
    status: 'active',
    activity: 'editing',
    attributionConfidence: 'verified',
    startedAt: '2026-08-18T00:00:00.000Z',
    lastObservedAt: input.lastObservedAt,
    endedAt: null,
  }
}

function claim(
  sessionId: string,
  path: string,
  at: string,
): ResourceClaim {
  return {
    id: `${sessionId}-${path}`,
    externalSessionId: sessionId,
    repositoryId: 'repo-a',
    resourceType: 'file',
    resourceKey: path,
    action: 'write',
    claimKind: 'observed',
    confidence: 'verified',
    firstObservedAt: at,
    lastObservedAt: at,
  }
}
