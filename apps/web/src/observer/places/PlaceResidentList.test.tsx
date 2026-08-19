import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import { PlaceResidentList } from './PlaceResidentList'

type RepositoryView = TodayOverview['repositories'][number]
type SessionView = RepositoryView['sessions'][number]

describe('PlaceResidentList', () => {
  it('shows every registered place as a ○○番 row', async () => {
    const onSelect = vi.fn()
    render(
      <PlaceResidentList
        overview={overviewOf([
          repository('repo_a', 'agent-workflow-kits', [
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
          repository('repo_b', 'notes', []),
        ])}
        workspaces={[
          {
            id: 'ws_repo_a',
            name: 'kits',
            employeeName: 'キット番',
            defaultProviderId: null,
            worldPackId: 'dog-office',
            createdAt: 't',
            updatedAt: 't',
            repository: {
              id: 'repo_a',
              absolutePath: '/tmp/kits',
              displayName: 'agent-workflow-kits',
              currentBranch: 'main',
              remoteName: null,
              remoteUrl: null,
              readable: true,
            },
          },
        ]}
        onSelect={onSelect}
      />,
    )

    const list = screen.getByRole('region', { name: '○○番の一覧' })
    expect(list).toBeVisible()
    expect(screen.getByText('キット番')).toBeVisible()
    expect(screen.getByText('agent-workflow-kits')).toBeVisible()
    expect(screen.getByText('動いている')).toBeVisible()
    expect(screen.getByText('APIを直している')).toBeVisible()
    expect(screen.getByText('notes番')).toBeVisible()
    expect(screen.getByText('静か')).toBeVisible()
    expect(screen.getByText('まだ分かっていません')).toBeVisible()

    await userEvent.click(screen.getByTestId('observer-place-repo_a'))
    expect(onSelect).toHaveBeenCalledWith('repo_a')
  })

  it('does not offer a job request action', () => {
    render(<PlaceResidentList overview={overviewOf([])} onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '仕事を頼む' })).toBeNull()
    expect(screen.getByText(/登録した場所がまだありません/)).toBeVisible()
  })
})

function overviewOf(
  repositories: TodayOverview['repositories'],
): TodayOverview {
  return {
    generatedAt: '2026-08-19T00:00:00.000Z',
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
): RepositoryView {
  return {
    repositoryId,
    workspaceId: `ws_${repositoryId}`,
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
    lastObservedAt: '2026-08-19T00:00:00.000Z',
    lastObservedLabel: null,
    ...partial,
  }
}
