import { describe, expect, it } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import type { Workspace } from '@sikumi-local/core'
import {
  collectGardenActors,
  collectPlaceResidents,
  deriveEmployeeName,
  derivePlaceName,
  placeActivityLabel,
  SHIKUMI_PLACE_NAME,
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
      operatorSummary: 'Codexが動かしている',
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
    expect(resident?.operatorSummary).toBeNull()
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
    expect(resident?.operatorSummary).toBe('Claude Codeが確認を待っています')
    expect(placeActivityLabel(resident!)).toBe('確認待ち')
  })
})

describe('collectGardenActors', () => {
  it('shows only live or very recent observed agents, not idle registered places', () => {
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
        repository('repo_c', 'ws_c', 'old-wait', [
          session({
            id: 'old',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: '見出しの直し',
            status: 'idle',
            activity: 'waiting',
            lastObservedAt: '2026-08-19T00:00:00.000Z',
          }),
        ]),
        repository('repo_d', 'ws_d', 'alpha', [
          session({
            id: 'git',
            source: 'git',
            displayName: '変更元不明',
            title: '変更元不明の作業',
            attributionConfidence: 'inferred',
          }),
        ]),
      ]),
      [workspace('ws_a', 'ブログ番')],
    )

    expect(actors).toHaveLength(1)
    expect(actors[0]).toMatchObject({
      placeName: 'ブログ番',
      repositoryName: 'my-blog',
      station: 'workbench',
      workSummary: 'APIを直している',
      operatorSummary: 'Codexが動かしている',
      stopped: false,
    })
  })

  it('keeps a just-stopped waiting agent so the last work can be inspected', () => {
    const actors = collectGardenActors(
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

    expect(actors).toHaveLength(1)
    expect(actors[0]).toMatchObject({
      placeName: 'alpha番',
      repositoryName: 'alpha',
      station: 'waiting',
      workSummary: '承認が必要',
      stopped: true,
    })
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
): RepositoryView {
  return {
    repositoryId,
    workspaceId,
    displayName,
    available: true,
    gitAvailable: true,
    summary: '',
    changedFileCount: 0,
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
