import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ObserverDashboard } from './ObserverDashboard'

describe('ObserverDashboard', () => {
  it('keeps an add-place path after places already exist', async () => {
    const onRegister = vi.fn()
    render(
      <ObserverDashboard
        overview={{
          generatedAt: '2026-08-18T00:00:00.000Z',
          repositoryCount: 1,
          activeRepositoryCount: 0,
          waitingCount: 0,
          conflictCount: 0,
          repositories: [
            {
              repositoryId: 'repo_1',
              workspaceId: 'ws_1',
              displayName: 'first',
              available: true,
              gitAvailable: true,
              summary: '現在観測中の作業はありません',
              changedFileCount: 0,
              lastChangedLabel: null,
              sessions: [],
              worktrees: [],
              conflicts: [],
              areas: [],
            },
          ],
        }}
        workspace={{
          id: 'ws_1',
          name: 'first',
          defaultProviderId: null,
          worldPackId: 'dog-office',
          createdAt: 't',
          updatedAt: 't',
          repository: {
            id: 'repo_1',
            absolutePath: '/tmp/first',
            displayName: 'first',
            currentBranch: 'main',
            remoteName: 'origin',
            remoteUrl: null,
            readable: true,
          },
        }}
        selectedRepositoryId={null}
        busy={false}
        error={null}
        onRegister={onRegister}
        onChooseFolder={async () => '/tmp/second'}
        onUnregister={vi.fn()}
        onSelectRepository={vi.fn()}
        onRescan={vi.fn()}
      />,
    )

    expect(screen.getByTestId('observer-add-repository')).toBeVisible()
    expect(screen.getByText('first番')).toBeVisible()
    expect(screen.getByText((content) => content === 'first')).toBeVisible()
    expect(screen.getByRole('region', { name: '○○番の一覧' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'この場所を外す' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを選ぶ' }))
    expect(screen.getByLabelText('場所のパス')).toHaveValue('/tmp/second')
    await userEvent.click(screen.getByRole('button', { name: 'この場所を追加' }))
    expect(onRegister).toHaveBeenCalledWith('/tmp/second', '')
  })
})
