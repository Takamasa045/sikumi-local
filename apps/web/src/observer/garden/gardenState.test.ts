import { describe, expect, it } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import {
  GARDEN_ACTIVE_WINDOW_MS,
  UNKNOWN_GARDEN_WORK,
  collectGardenState,
  describeGardenWork,
  isGenericWorkTitle,
  shouldShowGardenDog,
  stationForTone,
} from './gardenState'

type RepositoryView = TodayOverview['repositories'][number]
type SessionView = RepositoryView['sessions'][number]

const NOW = '2026-08-19T00:10:00.000Z'
const NOW_MS = Date.parse(NOW)

describe('shouldShowGardenDog', () => {
  it('shows a recently observed running session', () => {
    expect(
      shouldShowGardenDog(
        session({
          id: 'run',
          source: 'codex',
          status: 'running',
          activity: 'working',
          lastObservedAt: '2026-08-19T00:08:00.000Z',
        }),
        NOW_MS,
      ),
    ).toBe(true)
  })

  it('shows a waiting session even if the last observation is a bit older', () => {
    expect(
      shouldShowGardenDog(
        session({
          id: 'wait',
          source: 'claude-code',
          status: 'idle',
          activity: 'waiting-for-user',
          lastObservedAt: '2026-08-19T00:00:00.000Z',
        }),
        NOW_MS,
      ),
    ).toBe(true)
  })

  it('hides idle, stale, completed, and inferred sessions', () => {
    expect(
      shouldShowGardenDog(
        session({
          id: 'idle',
          source: 'cursor',
          displayName: 'エージェントワークフローキッズ版',
          status: 'idle',
          activity: 'idle',
          lastObservedAt: NOW,
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(
      shouldShowGardenDog(
        session({
          id: 'stale',
          source: 'codex',
          status: 'stale',
          activity: 'idle',
          lastObservedAt: NOW,
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(
      shouldShowGardenDog(
        session({
          id: 'done',
          source: 'codex',
          status: 'completed',
          activity: 'completed',
          lastObservedAt: NOW,
        }),
        NOW_MS,
      ),
    ).toBe(false)
    expect(
      shouldShowGardenDog(
        session({
          id: 'guess',
          source: 'codex',
          status: 'running',
          activity: 'working',
          attributionConfidence: 'inferred',
          lastObservedAt: NOW,
        }),
        NOW_MS,
      ),
    ).toBe(false)
  })

  it('hides a running session that was last seen outside the short window', () => {
    expect(
      shouldShowGardenDog(
        session({
          id: 'old',
          source: 'grok',
          status: 'active',
          activity: 'editing',
          lastObservedAt: new Date(
            NOW_MS - GARDEN_ACTIVE_WINDOW_MS - 1_000,
          ).toISOString(),
        }),
        NOW_MS,
      ),
    ).toBe(false)
  })
})

describe('describeGardenWork', () => {
  it('prefers a real title over boilerplate and the source name', () => {
    expect(
      describeGardenWork(
        session({
          id: 's1',
          source: 'codex',
          displayName: 'Codex',
          title: 'APIを直している',
        }),
        { displayName: 'alpha' },
      ),
    ).toBe('APIを直している')
  })

  it('uses a session name when the title is only a source template', () => {
    expect(
      describeGardenWork(
        session({
          id: 's1',
          source: 'cursor',
          displayName: 'ログイン画面の直し',
          title: 'Cursorの作業が始まりました',
        }),
        { displayName: 'alpha' },
      ),
    ).toBe('ログイン画面の直し')
  })

  it('falls back to the repository, then says the work is unknown', () => {
    expect(
      describeGardenWork(
        session({
          id: 's1',
          source: 'codex',
          displayName: 'Codex',
          title: 'Codexの作業が始まりました',
        }),
        { displayName: 'alpha' },
      ),
    ).toBe('alphaが対象です')
    expect(
      describeGardenWork(
        session({
          id: 's1',
          source: 'codex',
          displayName: 'Codex',
          title: 'Codexの様子が届きました',
        }),
        { displayName: '   ' },
      ),
    ).toBe(UNKNOWN_GARDEN_WORK)
  })

  it('treats source event templates as generic', () => {
    expect(isGenericWorkTitle('Codexの作業が始まりました')).toBe(true)
    expect(isGenericWorkTitle('Claude Codeの作業が終わりました')).toBe(true)
    expect(isGenericWorkTitle('Grok Buildが確認を待っています')).toBe(true)
    expect(isGenericWorkTitle('作業中')).toBe(true)
    expect(isGenericWorkTitle('APIを直している')).toBe(false)
  })
})

describe('collectGardenState', () => {
  it('keeps live dogs on the ground stations, not the observatory', () => {
    const { actors, bulletin } = collectGardenState(
      overviewOf([
        repository(
          'repo_a',
          'alpha',
          [
            session({
              id: 'run',
              source: 'codex',
              displayName: 'Codex',
              title: 'Codexの作業が始まりました',
              status: 'running',
              activity: 'working',
              lastObservedAt: NOW,
            }),
            session({
              id: 'kids',
              source: 'cursor',
              displayName: 'エージェントワークフローキッズ版',
              title: '作業',
              status: 'idle',
              activity: 'idle',
              lastObservedAt: NOW,
            }),
            session({
              id: 'git',
              source: 'git',
              displayName: 'Git作業',
              attributionConfidence: 'observed',
            }),
          ],
          3,
        ),
      ]),
    )

    expect(actors.map((actor) => actor.session.id)).toEqual(['run'])
    expect(actors[0]?.station).toBe('workbench')
    expect(actors[0]?.workSummary).toBe('alphaが対象です')
    expect(stationForTone('observing')).toBe('rest')
    expect(bulletin).toHaveLength(1)
    expect(bulletin[0]?.repository.displayName).toBe('alpha')
  })
})

function overviewOf(
  repositories: TodayOverview['repositories'],
): TodayOverview {
  return {
    generatedAt: NOW,
    repositoryCount: repositories.length,
    activeRepositoryCount: repositories.length,
    waitingCount: 0,
    conflictCount: 0,
    repositories,
  }
}

function repository(
  repositoryId: string,
  displayName: string,
  sessions: SessionView[],
  changedFileCount = 0,
): RepositoryView {
  return {
    repositoryId,
    workspaceId: `ws_${repositoryId}`,
    displayName,
    available: true,
    gitAvailable: true,
    summary: '',
    changedFileCount,
    lastChangedLabel: null,
    sessions,
    worktrees: [],
    conflicts: [],
    areas: [],
  }
}

function session(
  partial: Partial<SessionView> & Pick<SessionView, 'id' | 'source'>,
): SessionView {
  return {
    displayName: partial.displayName ?? partial.source,
    status: 'idle',
    activity: 'idle',
    attributionConfidence: 'observed',
    title: '作業',
    lastObservedAt: NOW,
    lastObservedLabel: null,
    ...partial,
  }
}
