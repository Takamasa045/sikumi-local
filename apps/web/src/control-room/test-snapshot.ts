import type { ControlPlaneSnapshot } from '../api/observer'

export function sampleSnapshot(
  overrides: Partial<ControlPlaneSnapshot> = {},
): ControlPlaneSnapshot {
  const works = overrides.works ?? [
    {
      id: 'codex-a',
      sessionId: 'codex-a',
      source: 'codex',
      surface: 'cli',
      displayName: 'Codex',
      repositoryId: 'repo-a',
      workspaceId: 'ws-a',
      title: 'ログイン画面の直し',
      activity: 'editing',
      status: 'active',
      attributionConfidence: 'verified',
      claimedPaths: ['src/auth.ts'],
      lastObservedAt: '2026-08-25T03:00:00.000Z',
      startedAt: '2026-08-25T02:50:00.000Z',
    },
    {
      id: 'cursor-a',
      sessionId: 'cursor-a',
      source: 'cursor',
      surface: 'cursor-agent',
      displayName: 'Cursor Agent',
      repositoryId: 'repo-a',
      workspaceId: 'ws-a',
      title: 'ログイン画面の直し',
      activity: 'editing',
      status: 'active',
      attributionConfidence: 'correlated',
      claimedPaths: ['src/auth.ts'],
      lastObservedAt: '2026-08-25T03:00:00.000Z',
      startedAt: '2026-08-25T02:52:00.000Z',
    },
  ]
  const attention = overrides.attention ?? [
    {
      id: 'conflict:same-file',
      kind: 'conflict',
      severity: 'red',
      title: '同じファイルを書いています',
      summary: '同じファイルを書いています',
      repositoryId: 'repo-a',
      source: 'codex',
      workIds: ['codex-a', 'cursor-a'],
      conflictId: 'same-file',
      evidence: ['同じファイルを書いています'],
      attributionConfidence: 'correlated',
      occurredAt: '2026-08-25T03:00:00.000Z',
    },
    {
      id: 'waiting:repo-a:codex',
      kind: 'waiting-for-user',
      severity: 'yellow',
      title: '確認待ち',
      summary: 'Codexが確認を待っています',
      repositoryId: 'repo-a',
      source: 'codex',
      workIds: ['codex-wait'],
      conflictId: null,
      evidence: ['確認を待っています'],
      attributionConfidence: 'verified',
      occurredAt: '2026-08-25T02:58:00.000Z',
    },
  ]
  return {
    generatedAt: '2026-08-25T03:00:00.000Z',
    works,
    attention,
    recommendations: overrides.recommendations ?? [],
    repositories: overrides.repositories ?? [
      {
        repositoryId: 'repo-a',
        displayName: 'alpha',
        available: true,
        works,
        attention,
        waitingCount: 1,
        staleCount: 0,
        conflictCount: 1,
      },
    ],
    observer: overrides.observer ?? {
      ok: false,
      degradedCount: 1,
      adapters: [
        {
          source: 'codex',
          status: 'degraded',
          lastEventAt: '2026-08-25T03:00:00.000Z',
        },
        {
          source: 'cursor',
          status: 'ready',
          lastEventAt: '2026-08-25T03:00:00.000Z',
        },
      ],
    },
  }
}

export function twoAgentsNoConflictSnapshot(): ControlPlaneSnapshot {
  const works = [
    {
      id: 'codex-a',
      sessionId: 'codex-a',
      source: 'codex',
      surface: 'cli',
      displayName: 'Codex',
      repositoryId: 'repo-a',
      workspaceId: 'ws-a',
      title: 'ログイン画面の直し',
      activity: 'editing',
      status: 'active',
      attributionConfidence: 'verified',
      claimedPaths: [],
      lastObservedAt: '2026-08-25T03:00:00.000Z',
      startedAt: '2026-08-25T02:50:00.000Z',
    },
    {
      id: 'cursor-a',
      sessionId: 'cursor-a',
      source: 'cursor',
      surface: 'ide',
      displayName: 'Cursor',
      repositoryId: 'repo-a',
      workspaceId: 'ws-a',
      title: 'テストを書いている',
      activity: 'testing',
      status: 'active',
      attributionConfidence: 'verified',
      claimedPaths: [],
      lastObservedAt: '2026-08-25T03:00:00.000Z',
      startedAt: '2026-08-25T02:52:00.000Z',
    },
  ]
  return sampleSnapshot({
    works,
    attention: [],
    repositories: [
      {
        repositoryId: 'repo-a',
        displayName: 'alpha',
        available: true,
        works,
        attention: [],
        waitingCount: 0,
        staleCount: 0,
        conflictCount: 0,
      },
    ],
    observer: {
      ok: true,
      degradedCount: 0,
      adapters: [
        {
          source: 'codex',
          status: 'ready',
          lastEventAt: '2026-08-25T03:00:00.000Z',
        },
      ],
    },
  })
}
