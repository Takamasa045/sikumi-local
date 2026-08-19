import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import { ObserverDashboard } from './ObserverDashboard'

describe('ObserverDashboard', () => {
  it('keeps an add-repository path after repositories already exist', async () => {
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
        onSelectRepository={vi.fn()}
        onRescan={vi.fn()}
      />,
    )

    expect(screen.getByTestId('observer-add-repository')).toBeVisible()
    expect(screen.getByText('first')).toBeVisible()
    await userEvent.type(
      screen.getByLabelText('観測するRepositoryの場所'),
      '/tmp/second',
    )
    await userEvent.click(
      screen.getByRole('button', { name: '観測するRepositoryを追加' }),
    )
    expect(onRegister).toHaveBeenCalledWith('/tmp/second', '')
  })

  it('opens a repository, warns about conflicts, and shows truncated stats', async () => {
    const onSelect = vi.fn()
    const onRescan = vi.fn()
    const onOpenConflicts = vi.fn()
    render(
      <ObserverDashboard
        overview={{
          generatedAt: '2026-08-18T00:00:00.000Z',
          repositoryCount: 1,
          activeRepositoryCount: 1,
          waitingCount: 1,
          conflictCount: 2,
          truncated: true,
          repositories: [
            {
              repositoryId: 'repo_1',
              workspaceId: 'ws_1',
              displayName: 'first',
              available: true,
              gitAvailable: true,
              summary: '変更があります',
              changedFileCount: 3,
              lastChangedLabel: '1分前',
              sessions: [
                {
                  id: 's1',
                  source: 'codex',
                  displayName: 'Codex',
                  status: 'running',
                  activity: 'working',
                  attributionConfidence: 'inferred',
                  title: '推測された作業',
                  lastObservedAt: 't',
                  lastObservedLabel: '1分前',
                },
              ],
              worktrees: [],
              conflicts: [],
              areas: ['認証'],
            },
          ],
        }}
        workspace={null}
        selectedRepositoryId="repo_1"
        busy={false}
        error={null}
        onRegister={vi.fn()}
        onSelectRepository={onSelect}
        onRescan={onRescan}
        onOpenConflicts={onOpenConflicts}
      />,
    )

    expect(screen.getByTestId('observer-truncated')).toBeVisible()
    expect(screen.getByTestId('observer-conflict-warning')).toBeVisible()
    expect(screen.getByText('関係しそうなところ: 認証')).toBeVisible()
    expect(screen.getByText('AIによる作業だと決めてはいません')).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: '衝突の一覧を見る' }),
    )
    expect(onOpenConflicts).toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole('button', { name: 'この場所を見る' }),
    )
    expect(onSelect).toHaveBeenCalledWith('repo_1')
    await userEvent.click(
      screen.getByRole('button', { name: 'いまの状態を確認' }),
    )
    expect(onRescan).toHaveBeenCalledWith('repo_1')
  })

  it('explains an empty workshop and unnamed leftover changes', () => {
    render(
      <ObserverDashboard
        overview={{
          generatedAt: '2026-08-18T00:00:00.000Z',
          repositoryCount: 0,
          activeRepositoryCount: 0,
          waitingCount: 0,
          conflictCount: 0,
          repositories: [],
        }}
        workspace={null}
        selectedRepositoryId={null}
        busy={false}
        error="場所を読めませんでした"
        onRegister={vi.fn()}
        onSelectRepository={vi.fn()}
        onRescan={vi.fn()}
      />,
    )
    expect(
      screen.getByText(
        '登録した場所がまだありません。上の欄からフォルダを追加してください。',
      ),
    ).toBeVisible()
    expect(screen.getByText('場所を読めませんでした')).toBeVisible()
  })

  it('tones repository cards by conflict level and leftover changes', () => {
    render(
      <ObserverDashboard
        overview={{
          generatedAt: 't',
          repositoryCount: 4,
          activeRepositoryCount: 4,
          waitingCount: 1,
          conflictCount: 3,
          repositories: [
            card('repo_high', 'high', 'open', 0, []),
            card('repo_caution', 'caution', 'open', 0, []),
            card('repo_wait', 'related', 'open', 0, [
              {
                id: 'w1',
                source: 'codex',
                displayName: 'Codex',
                status: 'waiting-for-user',
                activity: 'waiting',
                attributionConfidence: 'observed',
                title: '確認待ち',
                lastObservedAt: 't',
                lastObservedLabel: null,
              },
            ]),
            card('repo_idle', 'related', 'resolved', 0, []),
          ],
        }}
        workspace={null}
        selectedRepositoryId={null}
        busy={false}
        error={null}
        onRegister={vi.fn()}
        onSelectRepository={vi.fn()}
        onRescan={vi.fn()}
      />,
    )
    expect(screen.getByText('🔴 注意')).toBeVisible()
    expect(screen.getByText('🟠 注意')).toBeVisible()
    expect(screen.getByText('🟡 注意')).toBeVisible()
    expect(
      screen.getAllByText('現在観測中の作業はありません').length,
    ).toBeGreaterThan(0)
  })
})

function card(
  repositoryId: string,
  level: string,
  status: string,
  changedFileCount: number,
  sessions: TodayOverview['repositories'][number]['sessions'],
): TodayOverview['repositories'][number] {
  return {
    repositoryId,
    workspaceId: `ws_${repositoryId}`,
    displayName: repositoryId,
    available: true,
    gitAvailable: true,
    summary: 'summary',
    changedFileCount,
    lastChangedLabel: null,
    sessions,
    worktrees: [],
    conflicts: [
      {
        id: `cnf_${repositoryId}`,
        level,
        score: 10,
        summary: '衝突',
        status,
      },
    ],
    areas: [],
  }
}
