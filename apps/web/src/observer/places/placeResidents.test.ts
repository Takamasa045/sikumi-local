import { describe, expect, it } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import type { Workspace } from '@sikumi-local/core'
import {
  collectPlaceResidents,
  deriveEmployeeName,
  derivePlaceName,
  placeActivityLabel,
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
