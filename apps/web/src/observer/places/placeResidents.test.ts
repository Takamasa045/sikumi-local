import { describe, expect, it } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import type { Workspace } from '@sikumi-local/core'
import {
  WORKING_WALK_LANE_X,
  WORKING_WALK_STOPS,
  workingWalkPoint,
} from '../garden/gardenWalk'
import {
  ANOTHER_LIVE_WORK,
  assignGardenGroundPlots,
  collectGardenActors,
  collectPlaceResidents,
  deriveEmployeeName,
  derivePlaceName,
  describePlaceInspect,
  describeVisibleFacts,
  GARDEN_GROUND,
  GARDEN_WORK_GROUND,
  isGardenDeliveryGround,
  isGardenEdgeGround,
  isGardenWorkGround,
  LEFTOVER_WORK_REMAINING,
  placeActivityLabel,
  SHIKUMI_PLACE_NAME,
  sortPlaceResidents,
  spreadGardenGroundPlots,
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
      driverNote: null,
    })
    expect(residents[1]).toMatchObject({
      placeName: 'ウェブ番',
      repositoryName: 'my-website',
      working: false,
      waiting: false,
      lastObservedWork: '',
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
    expect(resident?.lastObservedWork).toBe('')
    expect(resident?.placeName).toBe('alpha番')
    expect(resident?.driverNote).toBeNull()
  })

  it('includes registered workspaces that are not yet in the overview', () => {
    const residents = collectPlaceResidents(overviewOf([]), [
      workspace('ws_only', 'ブログ番'),
    ])

    expect(residents).toHaveLength(1)
    expect(residents[0]).toMatchObject({
      placeName: 'ブログ番',
      working: false,
      lastObservedWork: '',
    })
  })

  it('keeps lastChangedAt and lastObservedAt for sorting', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_a',
          'ws_a',
          'alpha',
          [
            session({
              id: 'run',
              source: 'codex',
              lastObservedAt: '2026-08-19T00:09:00.000Z',
            }),
          ],
          { lastChangedAt: '2026-08-19T00:08:00.000Z' },
        ),
      ]),
    )

    expect(resident?.lastChangedAt).toBe('2026-08-19T00:08:00.000Z')
    expect(resident?.lastObservedAt).toBe('2026-08-19T00:09:00.000Z')
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
    expect(resident?.lastObservedWork).toBe('')
    expect(resident?.driverNote).toBeNull()
    expect(placeActivityLabel(resident!)).toBe('確認待ち')
  })
})

describe('sortPlaceResidents', () => {
  it('puts live places first, then newest lastChanged or lastObserved', () => {
    const residents = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_quiet_old',
          'ws_old',
          'old-notes',
          [
            session({
              id: 'old',
              source: 'codex',
              status: 'idle',
              activity: 'idle',
              lastObservedAt: '2026-08-18T00:00:00.000Z',
            }),
          ],
          { lastChangedAt: '2026-08-18T00:00:00.000Z' },
        ),
        repository(
          'repo_quiet_new',
          'ws_new',
          'new-notes',
          [
            session({
              id: 'recent',
              source: 'codex',
              status: 'idle',
              activity: 'idle',
              lastObservedAt: '2026-08-19T00:09:30.000Z',
            }),
          ],
          { lastChangedAt: '2026-08-19T00:04:00.000Z' },
        ),
        repository(
          'repo_working',
          'ws_work',
          'zeta',
          [
            session({
              id: 'run',
              source: 'codex',
              displayName: 'Codex',
              title: 'APIを直している',
              status: 'running',
              activity: 'working',
              lastObservedAt: '2026-08-19T00:08:00.000Z',
            }),
          ],
          { lastChangedAt: '2026-08-19T00:01:00.000Z' },
        ),
        repository(
          'repo_waiting',
          'ws_wait',
          'beta',
          [
            session({
              id: 'wait',
              source: 'claude-code',
              displayName: 'Claude Code',
              title: '承認が必要',
              status: 'idle',
              activity: 'waiting',
              lastObservedAt: '2026-08-19T00:09:00.000Z',
            }),
          ],
          { lastChangedAt: '2026-08-19T00:02:00.000Z' },
        ),
      ]),
    )

    expect(sortPlaceResidents(residents).map((item) => item.placeName)).toEqual(
      ['beta番', 'zeta番', 'new-notes番', 'old-notes番'],
    )
  })

  it('does not treat git inferred sessions as live work when sorting', () => {
    const residents = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_git',
          'ws_git',
          'git-only',
          [
            session({
              id: 'git',
              source: 'git',
              displayName: '変更元不明',
              title: '変更元不明の作業',
              attributionConfidence: 'inferred',
              lastObservedAt: '2026-08-19T00:09:50.000Z',
            }),
          ],
          { lastChangedAt: '2026-08-19T00:09:50.000Z' },
        ),
        repository(
          'repo_working',
          'ws_work',
          'alpha',
          [
            session({
              id: 'run',
              source: 'codex',
              title: 'APIを直している',
              status: 'running',
              activity: 'working',
              lastObservedAt: '2026-08-19T00:06:00.000Z',
            }),
          ],
          { lastChangedAt: '2026-08-19T00:01:00.000Z' },
        ),
      ]),
    )

    const sorted = sortPlaceResidents(residents)
    expect(sorted[0]?.placeName).toBe('alpha番')
    expect(sorted[0]?.working).toBe(true)
    expect(sorted[1]?.placeName).toBe('git-only番')
    expect(sorted[1]?.working).toBe(false)
    expect(sorted[1]?.waiting).toBe(false)
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
    expect(working?.repositoryName).toBe('my-blog')
    expect(working?.workSummary).toBe('APIを直している')
    expect(working?.nowText).toBe('CodexでAPIを直している')
    expect(working?.nextStep).toBeNull()
    expect(working?.driverNote).toBeNull()
    const quiet = actors.find((actor) => actor.placeName === 'notes番')
    expect(quiet?.workSummary).toBe('')
    expect(quiet?.nowText).toBeNull()
    expect(quiet?.implementationLook).toBeNull()
    expect(quiet?.nextStep).toBeNull()
    expect(['rest', 'delivery']).toContain(quiet?.station)
    expect(working?.groundX).not.toBe(quiet?.groundX)
    expect(Math.min(working!.groundX, quiet!.groundX)).toBeGreaterThanOrEqual(
      GARDEN_GROUND.minX,
    )
  })

  it('scatters quiet places across the back delivery ground', () => {
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
    expect(
      actors.every((actor) =>
        isGardenDeliveryGround({ x: actor.groundX, y: actor.groundY }),
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
    expect(
      isGardenWorkGround({
        x: working?.groundX ?? 0,
        y: working?.groundY ?? 0,
      }),
    ).toBe(true)
    expect(waiting?.groundX).toBeGreaterThan(GARDEN_WORK_GROUND.maxX)
    expect(quiet?.station).toBe('delivery')
    expect(
      isGardenDeliveryGround({
        x: quiet?.groundX ?? 0,
        y: quiet?.groundY ?? 0,
      }),
    ).toBe(true)
    expect((working?.groundY ?? 0) > (quiet?.groundY ?? 0)).toBe(true)
  })

  it('puts leftover work on the side rest and walking only in the front work', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_live', 'ws_live', 'alpha', [
          session({
            id: 'run',
            source: 'codex',
            displayName: 'Codex',
            title: 'APIを直している',
            status: 'running',
            activity: 'working',
          }),
        ]),
        repository('repo_wait', 'ws_wait', 'beta', [
          session({
            id: 'wait',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: '承認が必要',
            status: 'idle',
            activity: 'waiting',
          }),
        ]),
        repository('repo_left', 'ws_left', 'hataraki', [], {
          changedFileCount: 4,
          areas: ['画面'],
        }),
        repository('repo_done', 'ws_done', 'notes', []),
      ]),
    )

    const working = actors.find((actor) => actor.placeName === 'alpha番')
    const waiting = actors.find((actor) => actor.placeName === 'beta番')
    const leftover = actors.find((actor) => actor.placeName === 'hataraki番')
    const delivered = actors.find((actor) => actor.placeName === 'notes番')
    expect(working?.station).toBe('workbench')
    expect(waiting?.station).toBe('waiting')
    expect(leftover?.station).toBe('rest')
    expect(delivered?.station).toBe('delivery')
    expect(
      isGardenWorkGround({
        x: working?.groundX ?? 0,
        y: working?.groundY ?? 0,
      }),
    ).toBe(true)
    expect(
      isGardenEdgeGround({
        x: leftover?.groundX ?? 0,
        y: leftover?.groundY ?? 0,
      }),
    ).toBe(true)
    expect(
      isGardenDeliveryGround({
        x: delivered?.groundX ?? 0,
        y: delivered?.groundY ?? 0,
      }),
    ).toBe(true)
    expect((working?.groundY ?? 0) > (delivered?.groundY ?? 0)).toBe(true)
    expect(leftover?.station).not.toBe('delivery')
    for (const stop of WORKING_WALK_STOPS) {
      const point = workingWalkPoint(stop, working!)
      expect(isGardenWorkGround(point)).toBe(true)
      expect(isGardenDeliveryGround(point)).toBe(false)
    }
  })

  it('keeps unfinished leftover work off delivery even among several places', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_blog', 'ws_blog', 'my-blog', []),
        repository('repo_sikumi', 'ws_sikumi', 'sikumi-local', []),
        repository(
          'repo_hataraki',
          'ws_hataraki',
          'hataraki',
          [
            session({
              id: 'git',
              source: 'git',
              displayName: '変更元不明',
              title: '変更元不明の作業',
              attributionConfidence: 'inferred',
            }),
            session({
              id: 'fake',
              source: 'claude-code',
              displayName: 'Claude Code',
              title: 'Claude Codeがファイルを扱っています',
              lastObservedAt: '2026-08-19T00:00:00.000Z',
            }),
          ],
          {
            changedFileCount: 15,
            latestRecordTitle: 'feat: launch HATARAKI office UI',
          },
        ),
      ]),
    )

    const leftover = actors.find((actor) => actor.placeName === 'hataraki番')
    expect(leftover?.tone).toBe('observing')
    expect(leftover?.station).not.toBe('delivery')
    expect(leftover?.station).toBe('rest')
    expect(leftover?.workSummary).toBe('途中の仕事がある')
    expect(leftover?.workSummary).not.toContain(' / ')
    expect(leftover?.nowText).toBe(LEFTOVER_WORK_REMAINING)
    expect(leftover?.implementationLook).toBeNull()
    expect(JSON.stringify(leftover)).not.toMatch(
      /まだ分かっていません|変更元不明|feat:|作業中のファイル|Codexの作業が始まりました/,
    )
  })

  it('keeps two working places apart at the same walk stop and on the ground', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_hataraki', 'ws_hataraki', 'hataraki', [
          session({
            id: 'grok',
            source: 'grok-build',
            displayName: 'Grok Build',
            title: '働きの画面を直している',
            status: 'running',
            activity: 'working',
          }),
        ]),
        repository('repo_sikumi', 'ws_sikumi', 'sikumi-local', [
          session({
            id: 'codex',
            source: 'codex',
            surface: 'desktop-app',
            displayName: 'Codex',
            title: '庭の並列を直している',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    expect(actors).toHaveLength(2)
    expect(actors.every((actor) => actor.streamIndex === 0)).toBe(true)
    expect(actors.every((actor) => actor.tone === 'working')).toBe(true)
    expect(new Set(actors.map((actor) => actor.slot)).size).toBe(2)
    expect(
      Math.abs((actors[0]?.groundX ?? 0) - (actors[1]?.groundX ?? 0)),
    ).toBeGreaterThanOrEqual(WORKING_WALK_LANE_X)
    for (const stop of WORKING_WALK_STOPS) {
      const first = workingWalkPoint(stop, actors[0]!)
      const second = workingWalkPoint(stop, actors[1]!)
      expect(Math.abs(first.x - second.x)).toBeGreaterThanOrEqual(
        WORKING_WALK_LANE_X - 1,
      )
      expect(first).not.toEqual(second)
    }
  })

  it('makes a second walker when two live non-generic streams share one place', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_hataraki', 'ws_hataraki', 'hataraki', [
          session({
            id: 'grok',
            source: 'grok-build',
            displayName: 'Grok Build',
            title: '働きの画面を直している',
            status: 'running',
            activity: 'working',
            lastObservedLabel: '1分前',
          }),
          session({
            id: 'codex',
            source: 'codex',
            surface: 'desktop-app',
            displayName: 'Codex',
            title: '確認の仕組みを書いている',
            status: 'running',
            activity: 'working',
            lastObservedAt: '2026-08-19T00:08:00.000Z',
            lastObservedLabel: '2分前',
          }),
        ]),
      ]),
    )

    expect(actors).toHaveLength(2)
    expect(actors.map((actor) => actor.placeName)).toEqual([
      'hataraki番',
      'hataraki番',
    ])
    expect(actors.map((actor) => actor.workSummary).sort()).toEqual([
      '働きの画面を直している',
      '確認の仕組みを書いている',
    ])
    expect(new Set(actors.map((actor) => actor.key)).size).toBe(2)
    expect(new Set(actors.map((actor) => actor.groundX.toFixed(1))).size).toBe(
      2,
    )
    expect(
      Math.abs((actors[0]?.groundX ?? 0) - (actors[1]?.groundX ?? 0)),
    ).toBeGreaterThanOrEqual(12)
    expect(actors.every((actor) => actor.tone === 'working')).toBe(true)
    const grok = actors.find(
      (actor) => actor.workSummary === '働きの画面を直している',
    )
    const other = actors.find(
      (actor) => actor.workSummary === '確認の仕組みを書いている',
    )
    expect(grok?.nowText).toContain('Grokで働きの画面を直している')
    expect(grok?.nowText).not.toContain('確認の仕組みを書いている')
    expect(other?.nowText).toContain('Codexで確認の仕組みを書いている')
    expect(other?.nowText).not.toContain('働きの画面を直している')
    expect(other?.nowText).not.toContain('途中の仕事')
    expect(JSON.stringify(actors)).not.toContain('Grok Build')
    expect(
      actors.every(
        (actor) =>
          JSON.stringify(actor).match(
            /まだ分かっていません|SHA|\.tsx|\.css/,
          ) === null,
      ),
    ).toBe(true)
  })

  it('keeps one character when only one live stream is real', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository(
          'repo_hataraki',
          'ws_hataraki',
          'hataraki',
          [
            session({
              id: 'grok',
              source: 'grok-build',
              displayName: 'Grok Build',
              title: '働きの画面を直している',
              status: 'running',
              activity: 'working',
            }),
            session({
              id: 'fake',
              source: 'claude-code',
              displayName: 'Claude Code',
              title: 'Claude Codeがファイルを扱っています',
              surface: 'unknown',
              status: 'running',
              activity: 'working',
            }),
            session({
              id: 'start',
              source: 'codex',
              displayName: 'Codex',
              title: 'Codexの作業が始まりました',
              status: 'running',
              activity: 'working',
            }),
            session({
              id: 'git',
              source: 'git',
              displayName: '変更元不明',
              title: '変更元不明の作業',
              attributionConfidence: 'inferred',
            }),
          ],
          { changedFileCount: 4 },
        ),
      ]),
    )

    expect(actors).toHaveLength(1)
    expect(actors[0]?.placeName).toBe('hataraki番')
    expect(actors[0]?.workSummary).toBe('働きの画面を直している')
    expect(actors[0]?.streamIndex).toBe(0)
    expect(actors[0]?.nowText).not.toContain('Claude Code')
    expect(JSON.stringify(actors[0])).not.toMatch(
      /ファイルを扱っています|変更元不明|まだ分かっていません/,
    )
  })

  it('does not spawn a second walker from a stale Codex start', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_sikumi', 'ws_sikumi', 'sikumi-local', [
          session({
            id: 'live',
            source: 'codex',
            surface: 'desktop-app',
            displayName: 'Codex',
            title: '庭の並列を直している',
            status: 'active',
            activity: 'editing',
          }),
          session({
            id: 'start',
            source: 'codex',
            displayName: 'Codex',
            title: 'Codexの作業が始まりました',
            status: 'running',
            activity: 'working',
            lastObservedAt: '2026-08-18T20:00:00.000Z',
          }),
        ]),
      ]),
    )

    expect(actors).toHaveLength(1)
    expect(actors[0]?.placeName).toBe(SHIKUMI_PLACE_NAME)
    expect(actors[0]?.workSummary).toBe('庭の並列を直している')
    expect(actors[0]?.workSummary).not.toBe(ANOTHER_LIVE_WORK)
  })

  it('makes a second walker when two live CLI processes share one place even if both say 作業中', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_tsugite', 'ws_tsugite', 'tsugite', [
          session({
            id: 'grok-248',
            source: 'grok-build',
            surface: 'cli',
            displayName: 'Grok Build',
            title: '作業中',
            status: 'active',
            activity: 'editing',
            lastObservedLabel: 'たった今',
          }),
          session({
            id: 'grok-26794',
            source: 'grok-build',
            surface: 'cli',
            displayName: 'Grok Build',
            title: '作業中',
            status: 'active',
            activity: 'editing',
            lastObservedAt: '2026-08-19T00:09:00.000Z',
            lastObservedLabel: 'たった今',
          }),
        ]),
      ]),
    )

    expect(actors).toHaveLength(2)
    expect(actors.every((actor) => actor.placeName === 'tsugite番')).toBe(true)
    expect(actors.every((actor) => actor.tone === 'working')).toBe(true)
    expect(new Set(actors.map((actor) => actor.key)).size).toBe(2)
    expect(
      Math.abs((actors[0]?.groundX ?? 0) - (actors[1]?.groundX ?? 0)),
    ).toBeGreaterThanOrEqual(12)
    const summaries = actors.map((actor) => actor.workSummary)
    expect(summaries).toEqual(
      expect.arrayContaining(['動いている', ANOTHER_LIVE_WORK]),
    )
    expect(actors.some((actor) => actor.placeName === 'tsugite番 2')).toBe(
      false,
    )
    expect(actors.every((actor) => actor.nowText?.includes('Grokで'))).toBe(
      true,
    )
    expect(actors.some((actor) => actor.placeName.includes('Grok'))).toBe(false)
    expect(JSON.stringify(actors)).not.toMatch(
      /Grok Build|Claude Code|Codex|まだ分かっていません|変更元不明|fake-claude/,
    )
  })

  it('keeps the same everyday work words for two live Groks when the place was read', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository(
          'repo_tsugite',
          'ws_tsugite',
          'tsugite',
          [
            session({
              id: 'grok-248',
              source: 'grok-build',
              surface: 'cli',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedLabel: 'たった今',
            }),
            session({
              id: 'grok-26794',
              source: 'grok-build',
              surface: 'cli',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedAt: '2026-08-19T00:09:00.000Z',
              lastObservedLabel: 'たった今',
            }),
          ],
          { placeIntro: '継。ローカルで動画を作る工房です。' },
        ),
      ]),
      [workspace('ws_tsugite', '継番')],
    )

    expect(actors).toHaveLength(2)
    expect(actors.every((actor) => actor.placeName === '継番')).toBe(true)
    expect(
      actors.every((actor) => actor.workSummary === '動画を作っている'),
    ).toBe(true)
    expect(
      actors.every((actor) =>
        actor.nowText?.includes('Grokで動画を作っている'),
      ),
    ).toBe(true)
    expect(actors.some((actor) => actor.placeName === '継番 2')).toBe(false)
    expect(JSON.stringify(actors)).not.toMatch(
      /もう一つの仕事|Grok 2|Codex 2|Grok Build|fake-claude|変更元不明|縁側|SHA/,
    )
  })

  it('puts only the live tool in front of the same video work', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository(
          'repo_tsugite',
          'ws_tsugite',
          'tsugite',
          [
            session({
              id: 'grok-248',
              source: 'grok-build',
              surface: 'cli',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedLabel: 'たった今',
            }),
            session({
              id: 'codex',
              source: 'codex',
              surface: 'desktop-app',
              displayName: 'Codex',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedAt: '2026-08-19T00:09:30.000Z',
              lastObservedLabel: 'たった今',
            }),
          ],
          { placeIntro: '継。ローカルで動画を作る工房です。' },
        ),
      ]),
      [workspace('ws_tsugite', '継番')],
    )

    expect(actors).toHaveLength(2)
    expect(actors.every((actor) => actor.placeName === '継番')).toBe(true)
    expect(
      actors.every((actor) => actor.workSummary === '動画を作っている'),
    ).toBe(true)
    expect(
      actors.some((actor) => actor.nowText?.includes('Grokで動画を作っている')),
    ).toBe(true)
    expect(
      actors.some((actor) =>
        actor.nowText?.includes('Codexで動画を作っている'),
      ),
    ).toBe(true)
    expect(JSON.stringify(actors)).not.toMatch(
      /もう一つの仕事|Grok 2|Codex 2|Grok Build|fake-claude|変更元不明|縁側|SHA/,
    )
  })

  it('does not name a live Grok walker Codex when Codex is stale', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository(
          'repo_tsugite',
          'ws_tsugite',
          'tsugite',
          [
            session({
              id: 'grok-248',
              source: 'grok-build',
              surface: 'cli',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedLabel: 'たった今',
            }),
            session({
              id: 'codex',
              source: 'codex',
              surface: 'desktop-app',
              displayName: 'Codex',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedAt: '2026-08-18T23:00:00.000Z',
            }),
          ],
          { placeIntro: '継。ローカルで動画を作る工房です。' },
        ),
      ]),
      [workspace('ws_tsugite', '継番')],
    )

    expect(actors).toHaveLength(1)
    expect(actors[0]?.placeName).toBe('継番')
    expect(actors[0]?.workSummary).toBe('動画を作っている')
    expect(actors[0]?.nowText).toContain('Grokで動画を作っている')
    expect(actors[0]?.nowText).not.toContain('Codex')
    expect(JSON.stringify(actors)).not.toMatch(
      /もう一つの仕事|Codexで|Grok Build|fake-claude|変更元不明|縁側|SHA/,
    )
  })

  it('does not invent a live tool for leftover-only tsugite', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_tsugite', 'ws_tsugite', 'tsugite', [], {
          placeIntro: '継。ローカルで動画を作る工房です。',
          changedFileCount: 18,
        }),
      ]),
      [workspace('ws_tsugite', '継番')],
    )

    expect(actors).toHaveLength(1)
    expect(actors[0]?.placeName).toBe('継番')
    expect(actors[0]?.workSummary).toBe('動画の途中が残っている')
    expect(actors[0]?.nowText).not.toContain('Grokで')
    expect(actors[0]?.nowText).not.toContain('Codexで')
    expect(JSON.stringify(actors)).not.toMatch(
      /もう一つの仕事|Grok Build|fake-claude|変更元不明|縁側|SHA/,
    )
  })

  it('keeps one walker when only one live CLI process is at the place', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_tsugite', 'ws_tsugite', 'tsugite', [
          session({
            id: 'grok-248',
            source: 'grok-build',
            surface: 'cli',
            displayName: 'Grok Build',
            title: '作業中',
            status: 'active',
            activity: 'editing',
            lastObservedLabel: 'たった今',
          }),
          session({
            id: 'stale',
            source: 'grok-build',
            surface: 'cli',
            displayName: 'Grok Build',
            title: '作業中',
            status: 'active',
            activity: 'editing',
            lastObservedAt: '2026-08-18T20:00:00.000Z',
          }),
          session({
            id: 'fake',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: 'Claude Codeがファイルを扱っています',
            surface: 'unknown',
            status: 'running',
            activity: 'working',
          }),
          session({
            id: 'git',
            source: 'git',
            displayName: '変更元不明',
            title: '変更元不明の作業',
            attributionConfidence: 'inferred',
          }),
        ]),
      ]),
    )

    expect(actors).toHaveLength(1)
    expect(actors[0]?.placeName).toBe('tsugite番')
    expect(actors[0]?.streamIndex).toBe(0)
    expect(actors[0]?.workSummary).toBe('動いている')
    expect(actors[0]?.workSummary).not.toBe(ANOTHER_LIVE_WORK)
    expect(JSON.stringify(actors)).not.toMatch(
      /Claude Code|変更元不明|まだ分かっていません/,
    )
  })

  it('names a second untitled live stream as another job, not an invented title', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository('repo_a', 'ws_a', 'hataraki', [
          session({
            id: 'desk-a',
            source: 'codex',
            surface: 'desktop-app',
            displayName: 'Codex',
            title: '作業中',
            status: 'running',
            activity: 'working',
          }),
          session({
            id: 'desk-b',
            source: 'codex',
            surface: 'desktop-app',
            displayName: 'Codex',
            title: '作業中',
            status: 'running',
            activity: 'working',
            lastObservedAt: '2026-08-19T00:09:00.000Z',
          }),
        ]),
      ]),
    )

    expect(actors).toHaveLength(2)
    const summaries = actors.map((actor) => actor.workSummary)
    expect(summaries).toEqual(
      expect.arrayContaining(['動いている', ANOTHER_LIVE_WORK]),
    )
    expect(new Set(summaries).size).toBe(2)
    expect(actors.some((actor) => actor.placeName === 'hataraki 2')).toBe(false)
    expect(
      actors.every(
        (actor) => actor.nowText && !actor.nowText.includes('feat:'),
      ),
    ).toBe(true)
    expect(JSON.stringify(actors)).not.toMatch(
      /まだ分かっていません|SHA|articles\.log|働きの直し/,
    )
  })
})

describe('spreadGardenGroundPlots', () => {
  it('does not put a single resident on the left roof', () => {
    expect(spreadGardenGroundPlots(1)).toEqual([{ x: 50, y: 50 }])
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

  it('does not put unfinished leftover work on delivery', () => {
    const assigned = assignGardenGroundPlots([
      {
        repositoryId: 'dirty',
        waiting: false,
        working: false,
        changedFileCount: 9,
      },
      {
        repositoryId: 'outgoing',
        waiting: false,
        working: false,
        outgoingCount: 2,
      },
      { repositoryId: 'clean-a', waiting: false, working: false },
      { repositoryId: 'clean-b', waiting: false, working: false },
      { repositoryId: 'clean-c', waiting: false, working: false },
    ])
    expect(assigned.get('dirty')?.station).not.toBe('delivery')
    expect(assigned.get('outgoing')?.station).not.toBe('delivery')
    expect(assigned.get('dirty')?.station).toBe('rest')
    expect(assigned.get('outgoing')?.station).toBe('rest')
    expect(
      isGardenEdgeGround({
        x: assigned.get('dirty')?.x ?? 0,
        y: assigned.get('dirty')?.y ?? 0,
      }),
    ).toBe(true)
  })

  it('puts completed work on the back delivery ground', () => {
    const assigned = assignGardenGroundPlots([
      { repositoryId: 'done-a', waiting: false, working: false },
      { repositoryId: 'done-b', waiting: false, working: false },
      { repositoryId: 'done-c', waiting: false, working: false },
    ])
    expect(
      [...assigned.values()].some((plot) => plot.station === 'delivery'),
    ).toBe(true)
    expect(
      [...assigned.values()].every((plot) =>
        ['rest', 'delivery'].includes(plot.station),
      ),
    ).toBe(true)
    expect(
      [...assigned.values()]
        .filter((plot) => plot.station === 'delivery')
        .every((plot) => isGardenDeliveryGround(plot)),
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
      nowText:
        'CodexでAPIを直している\nCodexで画面の途中が残っています。\n最後に見えたのは1分前',
      implementationLook: null,
      nextStep: '画面の途中を続ける',
      driverNote: null,
      goal: 'APIを直している',
      placeIntro: null,
      articleTitles: [],
      workTitles: [],
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
    expect(inspect.nowText).toBe('ログインの途中が残っています。')
    expect(inspect.implementationLook).toBeNull()
    expect(inspect.nextStep).toBe('ログインの途中を続ける')
    expect(inspect.driverNote).toBeNull()
    expect(inspect.nowText).not.toContain('変更元不明')
    expect(inspect.nowText).not.toContain('まだ分かっていません')
    expect(inspect.nowText).not.toContain(' / ')
    expect(inspect.nowText).not.toContain('データの形')
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
      nowText: '確認待ち\n承認が必要',
      implementationLook: null,
      nextStep: '確認が必要',
      driverNote: null,
    })
  })

  it('asks for a check when observed AIs are approaching each other', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'alpha', [], {
          conflicts: [
            observedAgentConflict({
              leftSource: 'grok-build',
              rightSource: 'codex',
            }),
          ],
        }),
      ]),
    )

    expect(describePlaceInspect(resident!).nextStep).toBe('確認が必要')
    expect(describePlaceInspect(resident!).nowText).toBeNull()
    expect(describePlaceInspect(resident!).driverNote).toBeNull()
  })

  it('does not treat inferred git file overlap as a garden check', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'alpha', [], {
          conflictCount: 70,
        }),
      ]),
    )

    expect(resident?.conflictCount).toBe(0)
    expect(describePlaceInspect(resident!).nextStep).toBeNull()
    expect(describePlaceInspect(resident!).nowText).toBeNull()
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toMatch(
      /確認待ち|確認が必要|変更元不明/,
    )
  })

  it('does not name a tool from a generic Claude Code template', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'hataraki', [
          session({
            id: 'fake',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: 'Claude Codeがファイルを扱っています',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    expect(resident?.driverNote).toBeNull()
    expect(resident?.lastObservedWork).toBe('')
    expect(describePlaceInspect(resident!).nowText).toBe('動いている')
    expect(describePlaceInspect(resident!).nowText).not.toContain('Claude Code')
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toContain(
      'まだ分かっていません',
    )
  })

  it('uses the latest record title and everyday git status', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_a',
          'ws_a',
          'hataraki',
          [
            session({
              id: 'git',
              source: 'git',
              displayName: '変更元不明',
              title: '変更元不明の作業',
              attributionConfidence: 'inferred',
            }),
          ],
          {
            changedFileCount: 2,
            areas: ['画面'],
            latestRecordTitle: 'ログイン画面の直し',
            outgoingCount: 1,
            incomingCount: 1,
          },
        ),
      ]),
    )

    expect(resident?.lastObservedWork).toBe('ログイン画面の直し')
    expect(describePlaceInspect(resident!)).toEqual({
      nowText: '画面の途中が残っています。',
      implementationLook: null,
      nextStep: '画面の途中を続ける',
      driverNote: null,
      goal: null,
      placeIntro: 'いちばん新しい記録は『ログイン画面の直し』です',
      articleTitles: [],
      workTitles: ['ログイン画面の直し'],
    })
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toMatch(
      /SHA|commit|HEAD|origin|まだ分かっていません|Claude Code/,
    )
  })

  it('does not use a SHA or git jargon as the record title', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'hataraki', [], {
          latestRecordTitle: 'a1b2c3d',
          outgoingCount: 0,
          incomingCount: 0,
        }),
      ]),
    )

    expect(resident?.lastObservedWork).toBe('')
    expect(describePlaceInspect(resident!).nowText).toBeNull()
  })

  it('names Codex only when the desktop app is confirmed', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'hataraki', [
          session({
            id: 'desk',
            source: 'codex',
            surface: 'desktop-app',
            displayName: 'Codex',
            title: '作業中',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    expect(resident?.driverNote).toBe('Codexが動かしている')
    expect(resident?.lastObservedWork).toBe('')
    expect(describePlaceInspect(resident!).nowText).toBe('Codexで動いている')
  })

  it('puts the live tool in front of the current work words', () => {
    const [tsugite] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_tsugite',
          'ws_tsugite',
          'tsugite',
          [
            session({
              id: 'grok',
              source: 'grok-build',
              surface: 'cli',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
            }),
          ],
          { placeIntro: '継。ローカルで動画を作る工房です。' },
        ),
      ]),
      [workspace('ws_tsugite', '継番')],
    )
    expect(tsugite?.placeName).toBe('継番')
    expect(describePlaceInspect(tsugite!).nowText).toContain(
      'Grokで動画を作っている',
    )
    expect(JSON.stringify(describePlaceInspect(tsugite!))).not.toMatch(
      /Grok Build|fake-claude|変更元不明|縁側/,
    )

    const [claude] = collectPlaceResidents(
      overviewOf([
        repository('repo_notes', 'ws_notes', 'notes', [
          session({
            id: 'claude',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: '見出しを直している',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )
    expect(describePlaceInspect(claude!).nowText).toContain(
      'Claude Codeで見出しを直している',
    )
    expect(JSON.stringify(describePlaceInspect(claude!))).not.toContain(
      'fake-claude',
    )
  })
})

describe('describeVisibleFacts', () => {
  it('uses one everyday sentence and prefers the place over an English record', () => {
    const [working] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_a',
          'ws_a',
          'hataraki',
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
            areas: ['画面'],
          },
        ),
      ]),
    )
    expect(describeVisibleFacts(working!)).toBe('APIを直している')
    expect(describeVisibleFacts(working!)).not.toContain(' / ')
    expect(describeVisibleFacts(working!)).not.toContain('feat:')
    expect(describeVisibleFacts(working!)).not.toContain('作業中のファイル')

    const [areaOnly] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_b',
          'ws_b',
          'hataraki',
          [
            session({
              id: 'run',
              source: 'codex',
              displayName: 'Codex',
              title: '作業中',
              status: 'running',
              activity: 'working',
            }),
          ],
          { areas: ['画面'] },
        ),
      ]),
    )
    expect(describeVisibleFacts(areaOnly!)).toBe('画面まわりを直している')

    const [leftover] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_c',
          'ws_c',
          'hataraki',
          [
            session({
              id: 'git',
              source: 'git',
              displayName: '変更元不明',
              title: '変更元不明の作業',
              attributionConfidence: 'inferred',
            }),
            session({
              id: 'fake',
              source: 'claude-code',
              displayName: 'Claude Code',
              title: 'Claude Codeがファイルを扱っています',
              lastObservedAt: '2026-08-19T00:00:00.000Z',
            }),
          ],
          {
            changedFileCount: 15,
            latestRecordTitle: 'feat: launch HATARAKI office UI',
          },
        ),
      ]),
    )
    expect(leftover?.working).toBe(false)
    expect(describeVisibleFacts(leftover!)).toBe('途中の仕事がある')
    expect(describeVisibleFacts(leftover!)).not.toContain('feat:')
    expect(describeVisibleFacts(leftover!)).not.toContain(' / ')
    expect(describeVisibleFacts(leftover!)).not.toContain('しまっていない変更')
    expect(describePlaceInspect(leftover!).nowText).toBe(
      LEFTOVER_WORK_REMAINING,
    )
    expect(JSON.stringify(describePlaceInspect(leftover!))).not.toMatch(
      /まだ分かっていません|変更元不明|feat:|作業中のファイル| \/ /,
    )
  })

  it('summarizes leftover work from everyday areas without file names', () => {
    const files = hatarakiLeftoverFiles()
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_hataraki', 'ws_hataraki', 'hataraki', [], {
          changedFileCount: files.length,
          worktrees: [worktreeOf(files)],
        }),
      ]),
    )

    expect(describeVisibleFacts(resident!)).toBe(
      '画面や確認まわりに、途中の仕事がある',
    )
    expect(describeVisibleFacts(resident!)).not.toContain('しまっていない変更')
    const inspect = describePlaceInspect(resident!)
    expect(inspect.nowText).toBe('画面と確認の仕組みの途中が残っています。')
    expect(inspect.nextStep).toBe('画面と確認の仕組みの途中を続ける')
    expect(inspect.implementationLook).toBeNull()
    expect(inspect.nowText).not.toContain('しまっていない変更')
    expect(inspect.nowText).not.toContain('Office.tsx')
    expect(inspect.nowText).not.toContain('api-fixture-entry.ts')
    expect(inspect.nowText).not.toContain('package.json')
    expect(inspect.nowText).not.toContain('API')
    expect(inspect.nowText).not.toContain('データの形')
    expect(JSON.stringify(inspect)).not.toMatch(
      /しまっていない変更|commit|uncommitted|staged|SHA|HEAD|origin|まだ分かっていません|変更元不明|\.tsx|\.ts|\.css/,
    )
  })

  it('keeps leftover work off the inspect when nothing is left', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([repository('repo_a', 'ws_a', 'notes', [])]),
    )

    expect(describePlaceInspect(resident!).nowText).toBeNull()
    expect(describePlaceInspect(resident!).implementationLook).toBeNull()
    expect(describeVisibleFacts(resident!)).toBe('')
  })

  it('summarizes leftover work without listing a truncated file dump', () => {
    const files = Array.from({ length: 8 }, (_, index) =>
      leftoverFile(`src/screen/File${index}.tsx`, '画面'),
    )
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'hataraki', [], {
          changedFileCount: 40,
          worktrees: [
            worktreeOf(files, {
              changedFileCount: 40,
              filesTruncated: true,
            }),
          ],
        }),
      ]),
    )

    expect(describeVisibleFacts(resident!)).toBe(
      '画面まわりに、途中の仕事がある',
    )
    expect(describePlaceInspect(resident!).nowText).toBe(
      '画面の途中が残っています。',
    )
    expect(describePlaceInspect(resident!).nowText).not.toContain('File0.tsx')
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toContain(
      'しまっていない変更',
    )
  })

  it('summarizes しくみローカル番 leftover work in everyday Japanese', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_sikumi',
          'ws_sikumi',
          'sikumi-local',
          [
            session({
              id: 'seen',
              source: 'codex',
              displayName: 'Codex',
              title: '作業中',
              status: 'idle',
              activity: 'idle',
              lastObservedAt: '2026-08-18T20:10:00.000Z',
              lastObservedLabel: '4時間前',
            }),
          ],
          {
            changedFileCount: 227,
            areas: ['道具の一覧', '画面', 'データの形', 'API'],
          },
        ),
      ]),
    )

    expect(resident?.placeName).toBe(SHIKUMI_PLACE_NAME)
    expect(resident?.working).toBe(false)
    expect(describeVisibleFacts(resident!)).toBe(
      '道具や画面まわりに、途中の仕事がある',
    )
    expect(describePlaceInspect(resident!).nowText).toBe(
      '道具と画面の途中が残っています。\n最後に見えたのは4時間前',
    )
    expect(describePlaceInspect(resident!).nextStep).toBe(
      '道具と画面の途中を続ける',
    )
    expect(describePlaceInspect(resident!).nowText).not.toContain('observer.ts')
    expect(describePlaceInspect(resident!).nowText).not.toContain('schema.ts')
    expect(describePlaceInspect(resident!).nowText).not.toContain('データの形')
    expect(describePlaceInspect(resident!).nowText).not.toContain(
      '途中の仕事が227',
    )
  })

  it('uses a blog work story as the last-state article, never an invented title', () => {
    const [named] = collectPlaceResidents(
      overviewOf([
        repository('repo_blog', 'ws_blog', 'my-blog', [], {
          changedFileCount: 4,
          workStory:
            'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
        }),
      ]),
    )
    expect(describeVisibleFacts(named!)).toBe(
      'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
    )
    expect(describePlaceInspect(named!).nowText).toBe(
      'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です\n記事の途中が残っています。',
    )
    expect(describePlaceInspect(named!).nextStep).toBe('記事の途中を続ける')
    expect(describePlaceInspect(named!).placeIntro).toBeNull()
    expect(describePlaceInspect(named!).nowText).not.toContain('MEMORY.md')
    expect(describePlaceInspect(named!).nowText).not.toContain(
      'BLOG_WORKSPACE.md',
    )

    const [untitled] = collectPlaceResidents(
      overviewOf([
        repository('repo_blog2', 'ws_blog2', 'my-blog', [], {
          changedFileCount: 2,
          workStory: '記事の続きがある',
        }),
      ]),
    )
    expect(describeVisibleFacts(untitled!)).toBe('記事の続きがある')
    expect(describePlaceInspect(untitled!).nowText).toBe('記事の続きがある')
    expect(describePlaceInspect(untitled!).nextStep).toBe('記事の途中を続ける')
    expect(describePlaceInspect(untitled!).nowText).not.toContain('AIチーム')
  })

  it('puts a real live goal on inspect and keeps article history off the bubble', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_blog',
          'ws_blog',
          'my-blog',
          [
            session({
              id: 'run',
              source: 'codex',
              displayName: 'Codex',
              title: '見出しの直し',
              goal: '見出しの直し',
              status: 'running',
              activity: 'working',
            }),
          ],
          {
            workStory: 'いちばん新しい記事は『春のメモ』です',
            articleTitles: [
              { title: '春のメモ', date: '2026-08-15' },
              { title: '短い下書き', date: '2026-08-01' },
            ],
          },
        ),
      ]),
    )

    expect(resident?.goal).toBe('見出しの直し')
    expect(describeVisibleFacts(resident!)).toBe('見出しの直し')
    expect(describeVisibleFacts(resident!)).not.toContain('短い下書き')
    expect(describePlaceInspect(resident!).goal).toBe('見出しの直し')
    expect(describePlaceInspect(resident!).articleTitles).toEqual([
      { title: '春のメモ', date: '2026-08-15' },
      { title: '短い下書き', date: '2026-08-01' },
    ])
    expect(describePlaceInspect(resident!).workTitles).toEqual([])
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toContain(
      '縁側',
    )
  })

  it('lists spoken recent work titles for a non-blog place', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_hataraki', 'ws_hataraki', 'hataraki', [], {
          latestRecordTitle: '庭のクリック詳細を厚くする',
          workTitles: [
            '庭のクリック詳細を厚くする',
            'feat: launch HATARAKI office UI',
            'a1b2c3d',
            'ログイン画面の直し',
            'Merge branch main',
            'src/Office.tsx',
          ],
        }),
      ]),
    )

    expect(resident?.workTitles).toEqual([
      '庭のクリック詳細を厚くする',
      'ログイン画面の直し',
    ])
    expect(describePlaceInspect(resident!).workTitles).toEqual([
      '庭のクリック詳細を厚くする',
      'ログイン画面の直し',
    ])
    expect(describePlaceInspect(resident!).placeIntro).toBe(
      'いちばん新しい記録は『庭のクリック詳細を厚くする』です',
    )
    expect(describePlaceInspect(resident!).nowText).toBeNull()
    expect(describePlaceInspect(resident!).nextStep).toBeNull()
    expect(describePlaceInspect(resident!).articleTitles).toEqual([])
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toMatch(
      /feat:|a1b2c3d|Office\.tsx|Merge branch/,
    )
  })

  it('omits the work history when no spoken title was read', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'hataraki', [], {
          latestRecordTitle: 'feat: launch HATARAKI office UI',
          workTitles: ['feat: launch HATARAKI office UI', 'a1b2c3d'],
        }),
      ]),
    )

    expect(resident?.workTitles).toEqual([])
    expect(describePlaceInspect(resident!).workTitles).toEqual([])
  })

  it('does not put work titles on a blog kit place', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_blog', 'ws_blog', 'blog-agent-kit', [], {
          workStory: '記事の続きがある',
          workTitles: ['庭のクリック詳細を厚くする'],
        }),
      ]),
    )

    expect(resident?.workTitles).toEqual([])
    expect(describePlaceInspect(resident!).workTitles).toEqual([])
  })

  it('uses a README intro as the place contents, never inventing one', () => {
    const [named] = collectPlaceResidents(
      overviewOf([
        repository('repo_hataraki', 'ws_hataraki', 'hataraki', [], {
          placeIntro: '働きの画面を整えるための場所です。',
          latestRecordTitle: 'ログイン画面の直し',
        }),
      ]),
    )
    expect(describePlaceInspect(named!).placeIntro).toBe(
      '働きの画面を整えるための場所です。',
    )
    expect(describePlaceInspect(named!).nowText).toBeNull()
    expect(JSON.stringify(describePlaceInspect(named!))).not.toContain(
      'README.md',
    )

    const [unknown] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'notes', [], {
          placeIntro: 'まだ分かっていません',
        }),
      ]),
    )
    expect(describePlaceInspect(unknown!).placeIntro).toBeNull()
    expect(describePlaceInspect(unknown!).nowText).toBeNull()
    expect(describePlaceInspect(unknown!).nextStep).toBeNull()
  })

  it('uses a Japanese README intro as the place contents for leftover work', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_hataraki', 'ws_hataraki', 'hataraki', [], {
          placeIntro: 'AIセッションが、働く姿になる。',
          changedFileCount: 4,
          areas: ['確認用の仕組み', '作業中のファイル'],
        }),
      ]),
    )
    expect(describePlaceInspect(resident!).placeIntro).toBe(
      'AIセッションが、働く姿になる。',
    )
    expect(describeVisibleFacts(resident!)).toBe('働く姿の途中が残っている')
    expect(describePlaceInspect(resident!).nowText).toBe(
      '働く姿の途中が残っています。',
    )
    expect(describePlaceInspect(resident!).nextStep).toBe(
      '働く姿の途中を続ける',
    )
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toMatch(
      /確認用の仕組み|作業中のファイル|仕組みと途中|README/,
    )
  })

  it('speaks tsugite leftover and live work as video, not leftover confirmation areas', () => {
    const leftoverAreas = ['設定', '確認用の仕組み', '画面']
    const [leftover] = collectPlaceResidents(
      overviewOf([
        repository('repo_tsugite', 'ws_tsugite', 'tsugite', [], {
          placeIntro: '継。ローカルで動画を作る工房です。',
          changedFileCount: 18,
          areas: leftoverAreas,
        }),
      ]),
    )
    expect(describePlaceInspect(leftover!).placeIntro).toBe(
      '継。ローカルで動画を作る工房です。',
    )
    expect(describeVisibleFacts(leftover!)).toBe('動画の途中が残っている')
    expect(describeVisibleFacts(leftover!)).not.toMatch(
      /仕組みと途中|確認用の仕組み|作業中のファイル/,
    )
    expect(describePlaceInspect(leftover!).nowText).toBe(
      '動画の途中が残っています。',
    )
    expect(describePlaceInspect(leftover!).nowText).not.toContain('Grokで')
    expect(describePlaceInspect(leftover!).nowText).not.toContain('Codexで')
    expect(describePlaceInspect(leftover!).nextStep).toBe('動画の途中を続ける')
    expect(JSON.stringify(describePlaceInspect(leftover!))).not.toMatch(
      /仕組みと途中|確認用の仕組み|作業中のファイル|設定や確認|README/,
    )

    const [working] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_tsugite_live',
          'ws_tsugite_live',
          'tsugite',
          [
            session({
              id: 'grok',
              source: 'grok-build',
              surface: 'cursor-agent',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedLabel: 'たった今',
            }),
          ],
          {
            placeIntro: '動画を作る場所',
            changedFileCount: 18,
            areas: leftoverAreas,
          },
        ),
      ]),
    )
    expect(describeVisibleFacts(working!)).toBe('動画を作っている')
    expect(describePlaceInspect(working!).nowText).toContain(
      'Grokで動画を作っている',
    )
    expect(describePlaceInspect(working!).nowText).toContain(
      '最後に見えたのはたった今',
    )
    expect(describePlaceInspect(working!).nowText).not.toContain('Grok Build')
    expect(describePlaceInspect(working!).nextStep).toBe('動画の途中を続ける')
    expect(describePlaceInspect(working!).nowText).not.toMatch(
      /仕組みと途中|確認用の仕組み|確認の仕組み/,
    )
    expect(describePlaceInspect(working!).goal).toBeNull()
  })

  it('speaks leftover tsugite as video when the long README work sentence was read', () => {
    const leftoverAreas = ['設定', '確認用の仕組み', '画面']
    const workshop =
      'AI動画を作って終わりにせず、素材、制作ログ、判断、好みを次の制作へ継いでいくローカル動画制作工房です。'
    const [leftover] = collectPlaceResidents(
      overviewOf([
        repository('repo_tsugite', 'ws_tsugite', 'tsugite', [], {
          placeIntro: workshop,
          changedFileCount: 18,
          areas: leftoverAreas,
        }),
      ]),
    )
    expect(describePlaceInspect(leftover!).placeIntro).toBe(workshop)
    expect(describeVisibleFacts(leftover!)).toBe('動画の途中が残っている')
    expect(describePlaceInspect(leftover!).nowText).toBe(
      '動画の途中が残っています。',
    )
    expect(describePlaceInspect(leftover!).nextStep).toBe('動画の途中を続ける')
    expect(JSON.stringify(describePlaceInspect(leftover!))).not.toMatch(
      /仕組みと途中|確認の仕組みと画面|確認用の仕組み|作業中のファイル|English \| 日本語|Tsugite|README/,
    )
  })

  it('speaks しくみローカル leftover as the garden when the intro was read', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_sikumi', 'ws_sikumi', 'sikumi-local', [], {
          placeIntro: '観測の庭で、仕事の様子を見る場所です。',
          changedFileCount: 8,
          areas: ['確認用の仕組み', '設定'],
        }),
      ]),
    )
    expect(resident?.placeName).toBe(SHIKUMI_PLACE_NAME)
    expect(describeVisibleFacts(resident!)).toBe('観測の庭の途中が残っている')
    expect(describePlaceInspect(resident!).nowText).toBe(
      '観測の庭の途中が残っています。',
    )
    expect(describePlaceInspect(resident!).nextStep).toBe(
      '観測の庭の途中を続ける',
    )
    expect(describePlaceInspect(resident!).nowText).not.toContain(
      '確認用の仕組み',
    )
  })

  it('speaks leftover from a read intro even when no keyword look matched', () => {
    const leftoverAreas = ['確認用の仕組み', '作業中のファイル']
    const [leftover] = collectPlaceResidents(
      overviewOf([
        repository('repo_seminar', 'ws_seminar', 'seminar-place', [], {
          placeIntro: 'セミナーの運営をする場所です。',
          changedFileCount: 6,
          areas: leftoverAreas,
        }),
      ]),
    )
    expect(describePlaceInspect(leftover!).placeIntro).toBe(
      'セミナーの運営をする場所です。',
    )
    expect(describeVisibleFacts(leftover!)).toContain('セミナー')
    expect(describeVisibleFacts(leftover!)).toBe(
      'セミナーの運営の途中が残っている',
    )
    expect(describeVisibleFacts(leftover!)).not.toBe('途中の仕事がある')
    expect(describePlaceInspect(leftover!).nowText).toBe(
      'セミナーの運営の途中が残っています。',
    )
    expect(describePlaceInspect(leftover!).nextStep).toBe(
      'セミナーの運営の途中を続ける',
    )
    expect(JSON.stringify(describePlaceInspect(leftover!))).not.toMatch(
      /確認用の仕組み|作業中のファイル|仕組みと途中|README|seminar-place/,
    )

    const [working] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_seminar_live',
          'ws_seminar_live',
          'seminar-place',
          [
            session({
              id: 'run',
              source: 'codex',
              displayName: 'Codex',
              title: '作業中',
              status: 'running',
              activity: 'working',
            }),
          ],
          {
            placeIntro: 'セミナーの運営をする場所です。',
            changedFileCount: 6,
            areas: leftoverAreas,
          },
        ),
      ]),
    )
    expect(describeVisibleFacts(working!)).toBe('セミナーの運営している')
    expect(describePlaceInspect(working!).nowText).toContain(
      'セミナーの運営している',
    )
    expect(describePlaceInspect(working!).nextStep).toBe(
      'セミナーの運営の途中を続ける',
    )
    expect(describePlaceInspect(working!).nowText).not.toMatch(
      /確認用の仕組み|作業中のファイル|途中の仕事がある/,
    )
  })

  it('keeps leftover generic when no intro was read', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_plain', 'ws_plain', 'notes', [], {
          changedFileCount: 3,
          areas: ['確認用の仕組み', '作業中のファイル'],
        }),
      ]),
    )
    expect(describePlaceInspect(resident!).placeIntro).toBeNull()
    expect(describeVisibleFacts(resident!)).toBe('途中の仕事がある')
    expect(describePlaceInspect(resident!).nowText).toBe(
      LEFTOVER_WORK_REMAINING,
    )
    expect(describePlaceInspect(resident!).nextStep).toBe('途中の仕事を続ける')
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toMatch(
      /確認用の仕組み|作業中のファイル|セミナー/,
    )
  })

  it('does not speak leftover from confirmation tools, English-only intros, or 縁側', () => {
    const leftoverAreas = ['確認用の仕組み', '作業中のファイル']
    const [fromTools] = collectPlaceResidents(
      overviewOf([
        repository('repo_tools', 'ws_tools', 'notes', [], {
          placeIntro: '確認用の仕組み',
          changedFileCount: 4,
          areas: leftoverAreas,
        }),
      ]),
    )
    expect(describeVisibleFacts(fromTools!)).toBe('途中の仕事がある')
    expect(describeVisibleFacts(fromTools!)).not.toContain('確認用の仕組み')
    expect(describePlaceInspect(fromTools!).nowText).not.toContain(
      '確認用の仕組み',
    )

    const [english] = collectPlaceResidents(
      overviewOf([
        repository('repo_en', 'ws_en', 'notes', [], {
          placeIntro: 'A local video-production workshop.',
          changedFileCount: 4,
          areas: leftoverAreas,
        }),
      ]),
    )
    expect(describePlaceInspect(english!).placeIntro).toBeNull()
    expect(describeVisibleFacts(english!)).toBe('途中の仕事がある')
    expect(JSON.stringify(describePlaceInspect(english!))).not.toMatch(
      /video-production|workshop/,
    )

    const [engawa] = collectPlaceResidents(
      overviewOf([
        repository('repo_engawa', 'ws_engawa', 'notes', [], {
          placeIntro: '縁側にいます',
          changedFileCount: 4,
          areas: leftoverAreas,
        }),
      ]),
    )
    expect(describePlaceInspect(engawa!).placeIntro).toBeNull()
    expect(describeVisibleFacts(engawa!)).toBe('途中の仕事がある')
    expect(JSON.stringify(describePlaceInspect(engawa!))).not.toContain('縁側')
  })

  it('speaks しくみローカル leftover as observation from the live README sentence', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_sikumi', 'ws_sikumi', 'sikumi-local', [], {
          placeIntro:
            '登録した場所の様子を、観測の庭で見るローカルアプリです。仕事の依頼は各 AI 側で行い、庭は様子を見ます。',
          changedFileCount: 8,
          areas: ['確認用の仕組み', '設定'],
        }),
      ]),
    )
    expect(resident?.placeName).toBe(SHIKUMI_PLACE_NAME)
    expect(describeVisibleFacts(resident!)).toBe('観測の庭の途中が残っている')
    expect(describePlaceInspect(resident!).nowText).toBe(
      '観測の庭の途中が残っています。',
    )
    expect(describePlaceInspect(resident!).nextStep).toBe(
      '観測の庭の途中を続ける',
    )
    expect(describePlaceInspect(resident!).nowText).toContain('観測の庭')
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toMatch(
      /確認用の仕組み|作業中のファイル|仕組みと途中/,
    )
  })

  it('keeps a blog kit article title and list when the intro is 記事を書く場所', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_blog', 'ws_blog', 'blog-agent-kit', [], {
          placeIntro: '記事を書く場所',
          workStory:
            'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
          articleTitles: [
            {
              title: 'AIチームは多いほど強い、ではなかった',
              date: '2026-08-15',
            },
            { title: '春のメモ', date: '2026-08-01' },
          ],
          changedFileCount: 2,
        }),
      ]),
    )
    expect(describeVisibleFacts(resident!)).toBe(
      'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
    )
    expect(describePlaceInspect(resident!).placeIntro).toBe('記事を書く場所')
    expect(describePlaceInspect(resident!).nowText).toContain(
      'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
    )
    expect(describePlaceInspect(resident!).nextStep).toBe('記事の途中を続ける')
    expect(describePlaceInspect(resident!).articleTitles).toEqual([
      { title: 'AIチームは多いほど強い、ではなかった', date: '2026-08-15' },
      { title: '春のメモ', date: '2026-08-01' },
    ])
    expect(describePlaceInspect(resident!).workTitles).toEqual([])
  })

  it('does not treat hook leftovers or fake-claude as a goal', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository('repo_a', 'ws_a', 'sikumi-local', [
          session({
            id: 'fake',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: 'Claude Codeがファイルを扱っています',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    expect(resident?.goal).toBeNull()
    expect(describePlaceInspect(resident!).goal).toBeNull()
    expect(describePlaceInspect(resident!).nowText).toBe('動いている')
    expect(JSON.stringify(describePlaceInspect(resident!))).not.toContain(
      'ファイルを扱っています',
    )
  })

  it('keeps live Grok and Codex ahead of leftover confirmation and inferred git overlap', () => {
    const actors = collectGardenActors(
      overviewOf([
        repository(
          'repo_tsugite',
          'ws_tsugite',
          'tsugite',
          [
            session({
              id: 'grok',
              source: 'grok-build',
              surface: 'cursor-agent',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedLabel: 'たった今',
            }),
            session({
              id: 'codex',
              source: 'codex',
              surface: 'desktop-app',
              displayName: 'Codex',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedAt: '2026-08-19T00:09:30.000Z',
              lastObservedLabel: 'たった今',
            }),
          ],
          {
            changedFileCount: 122,
            areas: ['確認用の仕組み', '作業中のファイル'],
            conflictCount: 70,
          },
        ),
      ]),
    )

    expect(actors.length).toBeGreaterThanOrEqual(1)
    expect(actors.every((actor) => actor.tone === 'working')).toBe(true)
    expect(
      actors.some(
        (actor) =>
          actor.workSummary === '動いている' ||
          actor.workSummary === ANOTHER_LIVE_WORK,
      ),
    ).toBe(true)
    expect(actors.some((actor) => actor.nowText?.includes('Grokで'))).toBe(true)
    expect(actors.some((actor) => actor.nowText?.includes('Codexで'))).toBe(
      true,
    )
    expect(JSON.stringify(actors)).not.toContain('Grok Build')
    expect(
      actors.every((actor) => actor.goal === null || actor.goal === undefined),
    ).toBe(true)
    for (const actor of actors) {
      const inspect = {
        nowText: actor.nowText ?? '',
        nextStep: actor.nextStep ?? '',
        summary: actor.workSummary,
      }
      expect(inspect.summary).not.toMatch(/確認待ち|確認が必要/)
      expect(inspect.nowText).not.toMatch(/確認待ち|確認が必要/)
      expect(inspect.nextStep).not.toMatch(/確認待ち|確認が必要/)
      expect(inspect.nowText).not.toContain('確認まわりを直している')
      expect(JSON.stringify(actor)).not.toMatch(
        /まだ分かっていません|変更元不明|SHA|commit|HEAD/,
      )
    }

    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_tsugite',
          'ws_tsugite',
          'tsugite',
          [
            session({
              id: 'grok',
              source: 'grok-build',
              surface: 'cursor-agent',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedLabel: 'たった今',
            }),
            session({
              id: 'codex',
              source: 'codex',
              surface: 'desktop-app',
              displayName: 'Codex',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedAt: '2026-08-19T00:09:30.000Z',
              lastObservedLabel: 'たった今',
            }),
          ],
          {
            changedFileCount: 122,
            areas: ['確認用の仕組み', '作業中のファイル'],
            conflictCount: 70,
          },
        ),
      ]),
    )
    expect(resident?.working).toBe(true)
    expect(resident?.waiting).toBe(false)
    expect(resident?.conflictCount).toBe(0)
    expect(placeActivityLabel(resident!)).toBe('動いている')
    expect(describeVisibleFacts(resident!)).toBe('動いている')
    expect(describePlaceInspect(resident!).nowText).toContain('動いている')
    expect(describePlaceInspect(resident!).nowText).not.toMatch(
      /確認待ち|確認が必要|確認まわりを直している/,
    )
    expect(describePlaceInspect(resident!).nextStep).not.toMatch(
      /確認待ち|確認が必要/,
    )
    expect(describePlaceInspect(resident!).driverNote).toBe(
      'Grok BuildとCodexが動かしている',
    )
    expect(describePlaceInspect(resident!).goal).toBeNull()
  })

  it('says 確認待ち only when a live session is actually waiting', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_tsugite',
          'ws_tsugite',
          'tsugite',
          [
            session({
              id: 'wait',
              source: 'claude-code',
              displayName: 'Claude Code',
              title: '承認が必要',
              status: 'idle',
              activity: 'waiting',
            }),
          ],
          {
            changedFileCount: 122,
            areas: ['確認用の仕組み'],
            conflictCount: 70,
          },
        ),
      ]),
    )

    expect(resident?.waiting).toBe(true)
    expect(resident?.working).toBe(false)
    expect(placeActivityLabel(resident!)).toBe('確認待ち')
    expect(describeVisibleFacts(resident!)).not.toBe('確認待ち')
    expect(describePlaceInspect(resident!)).toMatchObject({
      nowText: expect.stringContaining('確認待ち'),
      nextStep: '確認が必要',
    })
  })

  it('replaces confirmation-wait copy when observation moves to live work', () => {
    const waiting = collectGardenActors(
      overviewOf([
        repository(
          'repo_hataraki',
          'ws_hataraki',
          'hataraki',
          [
            session({
              id: 'wait',
              source: 'grok-build',
              displayName: 'Grok Build',
              title: '承認が必要',
              status: 'idle',
              activity: 'waiting',
            }),
          ],
          {
            changedFileCount: 12,
            areas: ['確認用の仕組み'],
            conflictCount: 8,
          },
        ),
      ]),
    )
    expect(waiting[0]?.nowText).toMatch(/確認待ち/)
    expect(waiting[0]?.nextStep).toBe('確認が必要')

    const working = collectGardenActors(
      overviewOf([
        repository(
          'repo_hataraki',
          'ws_hataraki',
          'hataraki',
          [
            session({
              id: 'grok',
              source: 'grok-build',
              surface: 'cli',
              displayName: 'Grok Build',
              title: '働きの画面を直している',
              status: 'active',
              activity: 'editing',
              lastObservedLabel: 'たった今',
            }),
          ],
          {
            changedFileCount: 12,
            areas: ['確認用の仕組み'],
            conflictCount: 8,
          },
        ),
      ]),
    )
    expect(working[0]?.tone).toBe('working')
    expect(working[0]?.workSummary).toBe('働きの画面を直している')
    expect(working[0]?.nowText).toContain('働きの画面を直している')
    expect(working[0]?.nowText).not.toMatch(/確認待ち|確認が必要/)
    expect(working[0]?.nextStep).not.toMatch(/確認待ち|確認が必要/)
  })

  it('treats a live grok --cwd hataraki session as working, not stale or waiting', () => {
    const [resident] = collectPlaceResidents(
      overviewOf([
        repository(
          'repo_hataraki',
          'ws_hataraki',
          'hataraki',
          [
            session({
              id: 'grok',
              source: 'grok-build',
              surface: 'cli',
              displayName: 'Grok Build',
              title: '作業中',
              status: 'active',
              activity: 'editing',
              lastObservedLabel: 'たった今',
            }),
          ],
          { changedFileCount: 4, areas: ['確認用の仕組み'] },
        ),
      ]),
    )
    expect(resident?.working).toBe(true)
    expect(resident?.waiting).toBe(false)
    expect(placeActivityLabel(resident!)).toBe('動いている')
    expect(describeVisibleFacts(resident!)).toBe('動いている')
    expect(describeVisibleFacts(resident!)).not.toMatch(/確認待ち|確認が必要/)

    const [stale] = collectPlaceResidents(
      overviewOf([
        repository('repo_hataraki', 'ws_hataraki', 'hataraki', [
          session({
            id: 'stale',
            source: 'grok-build',
            surface: 'cli',
            displayName: 'Grok Build',
            title: '作業中',
            status: 'stale',
            activity: 'editing',
            lastObservedLabel: 'たった今',
          }),
        ]),
      ]),
    )
    expect(stale?.working).toBe(false)
    expect(placeActivityLabel(stale!)).toBe('静か')
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
    readonly conflicts?: RepositoryView['conflicts']
    readonly lastChangedAt?: string | null
    readonly latestRecordTitle?: string | null
    readonly workStory?: string | null
    readonly placeIntro?: string | null
    readonly articleTitles?: RepositoryView['articleTitles']
    readonly workTitles?: RepositoryView['workTitles']
    readonly outgoingCount?: number | null
    readonly incomingCount?: number | null
    readonly worktrees?: RepositoryView['worktrees']
    readonly truncated?: boolean
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
    lastChangedAt: extras.lastChangedAt ?? null,
    lastChangedLabel: null,
    latestRecordTitle: extras.latestRecordTitle ?? null,
    workStory: extras.workStory ?? null,
    placeIntro: extras.placeIntro ?? null,
    articleTitles: extras.articleTitles ?? [],
    workTitles: extras.workTitles ?? [],
    outgoingCount: extras.outgoingCount ?? null,
    incomingCount: extras.incomingCount ?? null,
    sessions,
    worktrees: extras.worktrees ?? [],
    ...(extras.truncated === undefined ? {} : { truncated: extras.truncated }),
    conflicts:
      extras.conflicts ?? inferredGitConflicts(extras.conflictCount ?? 0),
    areas: [...(extras.areas ?? [])],
  }
}

function inferredGitConflicts(count: number): RepositoryView['conflicts'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `conflict_${index}`,
    level: 'yellow',
    score: 40,
    summary: '変更元不明の2つの作業が同じ作業中のファイルを変更しています',
    status: 'open',
    leftSource: 'git',
    rightSource: 'git',
    leftAttributionConfidence: 'inferred',
    rightAttributionConfidence: 'inferred',
  }))
}

function observedAgentConflict(input: {
  readonly leftSource: string
  readonly rightSource: string
}): RepositoryView['conflicts'][number] {
  return {
    id: `conflict_${input.leftSource}_${input.rightSource}`,
    level: 'orange',
    score: 80,
    summary: '作業が近づいています',
    status: 'open',
    leftSource: input.leftSource,
    rightSource: input.rightSource,
    leftAttributionConfidence: 'reported',
    rightAttributionConfidence: 'reported',
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

type WorktreeFile = RepositoryView['worktrees'][number]['files'][number]

function leftoverFile(
  path: string,
  areaLabel: string,
  changeLabel = '変更',
): WorktreeFile {
  return {
    path,
    changeLabel,
    areaLabel,
    addedLines: null,
    deletedLines: null,
  }
}

function worktreeOf(
  files: readonly WorktreeFile[],
  extras: {
    readonly changedFileCount?: number
    readonly filesTruncated?: boolean
  } = {},
): RepositoryView['worktrees'][number] {
  return {
    path: 'primary',
    isPrimary: true,
    branch: null,
    changedFileCount: extras.changedFileCount ?? files.length,
    returnedFileCount: files.length,
    filesTruncated: extras.filesTruncated ?? false,
    files: [...files],
  }
}

function hatarakiLeftoverFiles(): WorktreeFile[] {
  return [
    leftoverFile('README.md', '作業中のファイル'),
    leftoverFile('src/App.tsx', '画面'),
    leftoverFile('src/office/Office.tsx', '画面'),
    leftoverFile('src/styles.css', '画面'),
    leftoverFile('e2e/garden.spec.ts', '確認用の仕組み'),
    leftoverFile('e2e/observer.spec.ts', '確認用の仕組み'),
    leftoverFile('e2e/visual-qa.spec.ts', '確認用の仕組み'),
    leftoverFile('e2e/workshop.spec.ts', '確認用の仕組み'),
    leftoverFile('e2e/api.spec.ts', '確認用の仕組み'),
    leftoverFile('package.json', '道具の一覧'),
    leftoverFile('e2e/api-fixture-entry.ts', 'API', 'まだ記録していない変更'),
    leftoverFile('e2e/fixtures/', '確認用の仕組み'),
    leftoverFile('server/', '作業中のファイル'),
    leftoverFile('src/live/', '作業中のファイル'),
    leftoverFile('src/office/Desk.tsx', '画面'),
    leftoverFile('playwright.config.ts', '設定'),
    leftoverFile('src/main.tsx', '画面'),
    leftoverFile('server/index.ts', '作業中のファイル'),
  ]
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
