import { describe, expect, it } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import type { Workspace } from '@sikumi-local/core'
import {
  assignGardenGroundPlots,
  collectGardenActors,
  collectPlaceResidents,
  deriveEmployeeName,
  derivePlaceName,
  describePlaceInspect,
  GARDEN_GROUND,
  placeActivityLabel,
  SHIKUMI_PLACE_NAME,
  spreadGardenGroundPlots,
  UNKNOWN_PLACE_WORK,
} from './placeResidents'

type RepositoryView = TodayOverview['repositories'][number]
type SessionView = RepositoryView['sessions'][number]

const NOW = '2026-08-19T00:10:00.000Z'

describe('derivePlaceName', () => {
  it('uses employeeName when it is present', () => {
    expect(derivePlaceName('agent-workflow-kits', 'キット番')).toBe('キット番')
  })

  it('derives ○○番 from the repository name', () => {
    expect(derivePlaceName('agent-workflow-kits')).toBe('agent-workflow-kits番')
    expect(deriveEmployeeName('my-blog')).toBe('ブログ番')
    expect(deriveEmployeeName('')).toBe('この場所番')
  })

  it('names shikumi and sikumi places しくみローカル番', () => {
    expect(deriveEmployeeName('sikumi-local')).toBe(SHIKUMI_PLACE_NAME)
    expect(deriveEmployeeName('my-shikumi-notes')).toBe(SHIKUMI_PLACE_NAME)
    expect(
      derivePlaceName('sikumi-e2e-garden-abc', 'sikumi-e2e-garden-abc番'),
    ).toBe(SHIKUMI_PLACE_NAME)
    expect(derivePlaceName('sikumi-local', 'キット番')).toBe('キット番')
  })
})

describe('collectPlaceResidents', () => {
  it('lists every registered place as a ○○番 row', () => {
    const residents = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'agent-workflow-kits', [
          session({
            id: 'run',
            source: 'codex',
            displayName: 'Codex',
            title: 'APIを直している',
            status: 'running',
            activity: 'working',
            lastObservedLabel: '1分前',
          }),
        ]),
        repository('repo_b', 'ws_b', 'my-website', []),
      ]),
      [workspace('ws_a', 'キット番'), workspace('ws_b')],
    )

    expect(residents).toHaveLength(2)
    expect(residents[0]).toMatchObject({
      placeName: 'キット番',
      repositoryName: 'agent-workflow-kits',
      working: true,
      waiting: false,
      lastObservedWork: 'APIを直している',
      lastObservedLabel: '1分前',
      lastObservedWorkLabel: '1分前',
      driverNote: 'Codexが動かしている',
    })
    expect(residents[1]).toMatchObject({
      placeName: 'ウェブ番',
      repositoryName: 'my-website',
      working: false,
      waiting: false,
      lastObservedWork: UNKNOWN_PLACE_WORK,
    })
  })

  it('does not treat git or inferred sessions as live work', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'alpha', [
          session({
            id: 'git',
            source: 'git',
            displayName: '変更元不明',
            title: '変更元不明の作業',
            attributionConfidence: 'inferred',
            lastObservedLabel: '2分前',
          }),
        ]),
      ]),
    )

    expect(resident?.working).toBe(false)
    expect(resident?.waiting).toBe(false)
    expect(resident?.lastObservedWork).toBe(UNKNOWN_PLACE_WORK)
    expect(resident?.placeName).toBe('alpha番')
  })

  it('includes registered workspaces that are not yet in the overview', () => {
    const residents = collectPlaceResidents(overviewOf([]), [
      workspace('ws_only', 'ブログ番'),
    ])

    expect(residents).toHaveLength(1)
    expect(residents[0]).toMatchObject({
      placeName: 'ブログ番',
      working: false,
      lastObservedWork: UNKNOWN_PLACE_WORK,
    })
  })

  it('marks waiting places without inventing a work title', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'alpha', [
          session({
            id: 'wait',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: 'Claude Codeが確認を待っています',
            status: 'idle',
            activity: 'waiting',
          }),
        ]),
      ]),
    )

    expect(resident?.waiting).toBe(true)
    expect(resident?.working).toBe(false)
    expect(resident?.lastObservedWork).toBe(UNKNOWN_PLACE_WORK)
    expect(placeActivityLabel(resident!)).toBe('確認待ち')
  })
})

describe('collectGardenActors', () => {
  it('makes one ground character per registered place', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_a', 'ws_a', 'my-blog', [
          session({
            id: 'run',
            source: 'codex',
            displayName: 'Codex',
            title: 'APIを直している',
            status: 'running',
            activity: 'working',
          }),
        ]),
        repository('repo_b', 'ws_b', 'notes', []),
      ]),
      [workspace('ws_a', 'ブログ番')],
    )

    expect(actors).toHaveLength(2)
    expect(actors.map((actor) => actor.placeName).sort()).toEqual([
      'notes番',
      'ブログ番',
    ])
    expect(
      actors.every((actor) =>
        ['workbench', 'delivery', 'waiting', 'rest'].includes(actor.station),
      ),
    ).toBe(true)
    expect(
      actors.every(
        (actor) => !['archive', 'observatory'].includes(actor.station),
      ),
    ).toBe(true)
    const working = actors.find((actor) => actor.placeName === 'ブログ番')
    expect(working?.station).toBe('workbench')
    expect(working?.workSummary).toBe('APIを直している')
    expect(working?.nowText).toBe('動いている。APIを直している')
    expect(working?.nextStep).toBe('いまの作業の続き')
    expect(working?.driverNote).toBe('Codexが動かしている')
    const quiet = actors.find((actor) => actor.placeName === 'notes番')
    expect(quiet?.workSummary).toBe(UNKNOWN_PLACE_WORK)
    expect(quiet?.nowText).toBe('静か。まだ分かっていません')
    expect(quiet?.implementationLook).toBe(UNKNOWN_PLACE_WORK)
    expect(quiet?.nextStep).toBe('次に動かすまで待つ')
    expect(['rest', 'delivery']).toContain(quiet?.station)
    expect(working?.groundX).not.toBe(quiet?.groundX)
    expect(Math.min(working!.groundX, quiet!.groundX)).toBeGreaterThanOrEqual(
      GARDEN_GROUND.minX,
    )
  })

  it('scatters quiet places across the center-to-right ground', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_a', 'ws_a', 'alpha', []),
        repository('repo_b', 'ws_b', 'beta', []),
        repository('repo_c', 'ws_c', 'gamma', []),
        repository('repo_d', 'ws_d', 'delta', []),
      ]),
    )

    const xs = actors.map((actor) => actor.groundX)
    expect(actors).toHaveLength(4)
    expect(new Set(xs.map((value) => value.toFixed(1))).size).toBe(4)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(GARDEN_GROUND.minX)
    expect(Math.max(...xs)).toBeLessThanOrEqual(GARDEN_GROUND.maxX)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20)
    expect(
      actors.every(
        (actor) =>
          !['archive', 'observatory'].includes(actor.station) &&
          actor.groundY >= GARDEN_GROUND.minY &&
          actor.groundY <= GARDEN_GROUND.maxY,
      ),
    ).toBe(true)
  })

  it('keeps working and waiting near their meaning without stacking', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_a', 'ws_a', 'alpha', [
          session({
            id: 'run',
            source: 'codex',
            displayName: 'Codex',
            title: 'APIを直している',
            status: 'running',
            activity: 'working',
          }),
        ]),
        repository('repo_b', 'ws_b', 'beta', [
          session({
            id: 'wait',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: '承認が必要',
            status: 'idle',
            activity: 'waiting',
          }),
        ]),
        repository('repo_c', 'ws_c', 'gamma', []),
      ]),
    )

    const working = actors.find((actor) => actor.placeName === 'alpha番')
    const waiting = actors.find((actor) => actor.placeName === 'beta番')
    const quiet = actors.find((actor) => actor.placeName === 'gamma番')
    expect(working?.station).toBe('workbench')
    expect(waiting?.station).toBe('waiting')
    expect(['rest', 'delivery']).toContain(quiet?.station)
    expect(new Set(actors.map((actor) => actor.groundX.toFixed(1))).size).toBe(
      3,
    )
    expect(Math.abs((working?.groundX ?? 0) - 49)).toBeLessThan(
      Math.abs((waiting?.groundX ?? 0) - 49),
    )
    expect(Math.abs((waiting?.groundX ?? 0) - 78)).toBeLessThan(
      Math.abs((working?.groundX ?? 0) - 78),
    )
  })
})

describe('spreadGardenGroundPlots', () => {
  it('does not put a single resident on the left roof', () => {
    expect(spreadGardenGroundPlots(1)).toEqual([{ x: 58, y: 50 }])
  })

  it('gives each resident a distinct ground plot', () => {
    const plots = spreadGardenGroundPlots(5)
    expect(plots).toHaveLength(5)
    expect(new Set(plots.map((plot) => plot.x.toFixed(2))).size).toBe(5)
    expect(plots[0]?.x).toBe(GARDEN_GROUND.minX)
    expect(plots[4]?.x).toBe(GARDEN_GROUND.maxX)
  })
})

describe('assignGardenGroundPlots', () => {
  it('never assigns the roof or telescope stations', () => {
    const assigned = assignGardenGroundPlots([
      { repositoryId: 'a', waiting: false, working: false },
      { repositoryId: 'b', waiting: false, working: false },
      { repositoryId: 'c', waiting: false, working: true },
    ])
    expect(
      [...assigned.values()].every(
        (plot) => !['archive', 'observatory'].includes(plot.station),
      ),
    ).toBe(true)
  })
})

describe('describePlaceInspect', () => {
  it('says what is happening now, how the work looks, and what comes next', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_a',
          'ws_a',
          'my-blog',
          [
            session({
              id: 'run',
              source: 'codex',
              displayName: 'Codex',
              title: 'APIを直している',
              status: 'running',
              activity: 'working',
              lastObservedLabel: '1分前',
            }),
          ],
          {
            changedFileCount: 3,
            areas: ['画面', 'API', '作業中のファイル'],
          },
        ),
      ]),
    )

    expect(describePlaceInspect(resident!)).toEqual({
      nowText: '動いている。APIを直している（1分前）',
      implementationLook: '作業中のファイルがいくつかある。画面やAPIあたりです',
      nextStep: 'いまの作業の続き',
      driverNote: 'Codexが動かしている',
    })
  })

  it('does not use git unknown-source copy as the job name', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_a',
          'ws_a',
          'alpha',
          [
            session({
              id: 'git',
              source: 'git',
              displayName: '変更元不明',
              title: '変更元不明の作業',
              attributionConfidence: 'inferred',
              lastObservedLabel: '2分前',
            }),
          ],
          {
            changedFileCount: 1,
            areas: ['ログイン状態'],
          },
        ),
      ]),
    )

    const inspect = describePlaceInspect(resident!)
    expect(inspect.nowText).toBe('静か。まだ分かっていません')
    expect(inspect.implementationLook).toBe(
      '作業中のファイルが1つある。ログイン状態あたりです',
    )
    expect(inspect.nextStep).toBe('次に動かすまで待つ')
    expect(inspect.driverNote).toBeNull()
    expect(inspect.nowText).not.toContain('変更元不明')
    expect(inspect.implementationLook).not.toContain('変更元不明')
  })

  it('asks for a check when the place is waiting', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'alpha', [
          session({
            id: 'wait',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: '承認が必要',
            status: 'idle',
            activity: 'waiting',
          }),
        ]),
      ]),
    )

    expect(describePlaceInspect(resident!)).toMatchObject({
      nowText: '確認待ち。承認が必要',
      implementationLook: UNKNOWN_PLACE_WORK,
      nextStep: '確認が必要',
      driverNote: 'Claude Codeが動かしている',
    })
  })

  it('asks for a check when overlapping work is already known', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'alpha', [], {
          conflictCount: 1,
        }),
      ]),
    )

    expect(describePlaceInspect(resident!).nextStep).toBe('確認が必要')
    expect(describePlaceInspect(resident!).nowText).toBe(
      '静か。まだ分かっていません',
    )
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
  workspaceId: string,
  displayName: string,
  sessions: SessionView[],
  extras: {
    readonly changedFileCount?: number
    readonly areas?: readonly string[]
    readonly conflictCount?: number
  } = {},
): RepositoryView {
  return {
    repositoryId,
    workspaceId,
    displayName,
    available: true,
    gitAvailable: true,
    summary: '',
    changedFileCount: extras.changedFileCount ?? 0,
    lastChangedLabel: null,
    sessions,
    worktrees: [],
    conflicts: Array.from(
      { length: extras.conflictCount ?? 0 },
      (_, index) => ({
        id: `conflict_${index}`,
        level: 'yellow',
        score: 40,
        summary: '作業が近づいています',
        status: 'open',
      }),
    ),
    areas: [...(extras.areas ?? [])],
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

function workspace(id: string, employeeName?: string): Workspace {
  return {
    id,
    name: id,
    ...(employeeName ? { employeeName } : {}),
    defaultProviderId: null,
    worldPackId: 'dog-office',
    createdAt: NOW,
    updatedAt: NOW,
    repository: {
      id: `repo_${id}`,
      absolutePath: `/tmp/${id}`,
      displayName: id,
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: null,
      readable: true,
    },
  }
}
