import { describe, expect, it } from 'vitest'
import { claim, event, NOW_MS, session } from './control-plane-fixtures.js'
import { buildObservedWorks } from './situation.js'

describe('buildObservedWorks', () => {
  it('builds one ObservedWork for a single named agent', () => {
    const works = buildObservedWorks({
      sessions: [session({ id: 'codex-a', source: 'codex' })],
      events: [
        event({
          id: 'ev-1',
          source: 'codex',
          externalSessionId: 'codex-a',
        }),
      ],
      claims: [claim('codex-a', 'src/auth.ts')],
      now: NOW_MS,
    })
    expect(works).toHaveLength(1)
    expect(works[0]).toMatchObject({
      id: 'codex-a',
      source: 'codex',
      displayName: 'Codex',
      repositoryId: 'repo-a',
      activity: 'editing',
      status: 'active',
      attributionConfidence: 'verified',
      claimedPaths: ['src/auth.ts'],
      title: 'ログイン画面の直し',
    })
  })

  it('keeps two agents in the same repository as two works', () => {
    const works = buildObservedWorks({
      sessions: [
        session({ id: 'codex-a', source: 'codex' }),
        session({ id: 'cursor-a', source: 'cursor', surface: 'cursor-agent' }),
      ],
      now: NOW_MS,
    })
    expect(works.map((item) => item.displayName)).toEqual(['Codex', 'Cursor Agent'])
    expect(new Set(works.map((item) => item.repositoryId))).toEqual(new Set(['repo-a']))
  })

  it('keeps two agents in different repositories separate', () => {
    const works = buildObservedWorks({
      sessions: [
        session({ id: 'codex-a', source: 'codex', repositoryId: 'repo-a' }),
        session({
          id: 'claude-b',
          source: 'claude-code',
          repositoryId: 'repo-b',
        }),
      ],
      now: NOW_MS,
    })
    expect(works).toHaveLength(2)
    expect(works.map((item) => item.repositoryId).sort()).toEqual(['repo-a', 'repo-b'])
  })

  it('does not treat git sessions as ObservedWork', () => {
    const works = buildObservedWorks({
      sessions: [
        session({
          id: 'git-a',
          source: 'git',
          attributionConfidence: 'inferred',
          title: '変更元不明の作業',
        }),
      ],
      git: [
        {
          repositoryId: 'repo-a',
          available: true,
          changedFileCount: 2,
          changedPaths: ['src/a.ts', 'src/b.ts'],
          scannedAt: '2026-08-25T03:00:00.000Z',
        },
      ],
      now: NOW_MS,
    })
    expect(works).toEqual([])
  })

  it('marks waiting from a later permission event', () => {
    const works = buildObservedWorks({
      sessions: [
        session({
          id: 'codex-a',
          source: 'codex',
          lastObservedAt: '2026-08-25T02:59:00.000Z',
        }),
      ],
      events: [
        event({
          id: 'wait',
          source: 'codex',
          externalSessionId: 'codex-a',
          normalizedType: 'permission.requested',
          activity: 'waiting-for-user',
          occurredAt: '2026-08-25T03:00:00.000Z',
        }),
      ],
      now: NOW_MS,
    })
    expect(works[0]?.status).toBe('waiting-for-user')
  })

  it('drops ended sessions and does not use worktrees as places', () => {
    const works = buildObservedWorks({
      sessions: [
        session({ id: 'done', source: 'codex', status: 'ended' }),
        session({
          id: 'live',
          source: 'codex',
          worktreePath: '/tmp/repo-a/.worktrees/feature',
        }),
      ],
      now: NOW_MS,
    })
    expect(works).toHaveLength(1)
    expect(works[0]?.id).toBe('live')
    expect(works[0]?.repositoryId).toBe('repo-a')
  })
})
