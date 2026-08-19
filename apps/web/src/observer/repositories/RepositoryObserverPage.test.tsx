import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RepositoryActivity } from '../../api/observer'
import { RepositoryObserverPage } from './RepositoryObserverPage'

describe('RepositoryObserverPage', () => {
  it('shows the empty state and returns to the workshop', async () => {
    const onBack = vi.fn()
    render(
      <RepositoryObserverPage
        activity={null}
        busy={false}
        onBack={onBack}
        onRescan={vi.fn()}
      />,
    )
    expect(
      screen.getByText('この場所の様子をまだ受け取っていません。'),
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: '今日の作業場へ戻る' }),
    )
    expect(onBack).toHaveBeenCalled()
  })

  it('renders truncated worktrees, inferred sessions, and conflict actions', async () => {
    const onOpenConflicts = vi.fn()
    const onRescan = vi.fn()
    render(
      <RepositoryObserverPage
        activity={activity({
          truncated: true,
          sessions: [
            {
              id: 's1',
              source: 'codex',
              displayName: 'Codex',
              status: 'running',
              activity: 'working',
              attributionConfidence: 'observed',
              title: 'APIを直している',
              lastObservedAt: 't',
              lastObservedLabel: '1分前',
            },
            {
              id: 's2',
              source: 'git',
              displayName: '変更元不明',
              status: 'detected',
              activity: 'unknown',
              attributionConfidence: 'inferred',
              title: '未確認の差分',
              lastObservedAt: 't',
              lastObservedLabel: null,
            },
          ],
          worktrees: [
            {
              path: '/repo',
              isPrimary: true,
              branch: 'main',
              changedFileCount: 12,
              returnedFileCount: 2,
              filesTruncated: true,
              files: [
                {
                  path: 'src/a.ts',
                  changeLabel: '変更',
                  areaLabel: '認証',
                  addedLines: 1,
                  deletedLines: 0,
                },
              ],
            },
            {
              path: '/repo-feature',
              isPrimary: false,
              branch: 'feature',
              changedFileCount: 1,
              filesTruncated: false,
              files: [
                {
                  path: 'src/b.ts',
                  changeLabel: '追加',
                  areaLabel: '画面',
                  addedLines: 3,
                  deletedLines: 0,
                },
              ],
            },
          ],
          conflicts: [
            {
              id: 'cnf_1',
              level: 'high',
              score: 80,
              summary: '同じファイルを変更しています',
              headline: '同じ仕組みを変更しています',
              status: 'open',
            },
          ],
        })}
        busy
        onBack={vi.fn()}
        onRescan={onRescan}
        onOpenConflicts={onOpenConflicts}
      />,
    )

    expect(screen.getByTestId('activity-truncated')).toBeVisible()
    expect(screen.getByText('Codex / APIを直している')).toBeVisible()
    expect(
      screen.getByText('変更元不明 / 未確認の差分（変更元不明）'),
    ).toBeVisible()
    expect(screen.getByText('本体の作業場')).toBeVisible()
    expect(screen.getByText('別の作業場')).toBeVisible()
    expect(screen.getByTestId('worktree-truncated')).toBeVisible()
    expect(screen.getByText('認証（変更）')).toBeVisible()
    expect(screen.getByText(/1 件の衝突注意/)).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: '衝突の詳細を見る' }),
    )
    expect(onOpenConflicts).toHaveBeenCalledWith('cnf_1')
    expect(
      screen.getByRole('button', { name: 'いまの状態を確認' }),
    ).toBeDisabled()
  })

  it('shows empty sessions and conflicts without inventing work', () => {
    render(
      <RepositoryObserverPage
        activity={activity({ sessions: [], worktrees: [], conflicts: [] })}
        busy={false}
        onBack={vi.fn()}
        onRescan={vi.fn()}
      />,
    )
    expect(screen.getByText('直接つながった作業はありません。')).toBeVisible()
    expect(
      screen.getByText('いま重なっている作業は見当たりません。'),
    ).toBeVisible()
  })
})

function activity(
  partial: Partial<RepositoryActivity> = {},
): RepositoryActivity {
  return {
    repositoryId: 'repo_1',
    workspaceId: 'ws_1',
    displayName: 'demo',
    available: true,
    gitAvailable: true,
    summary: 'いまの作業があります',
    changedFileCount: 2,
    lastChangedLabel: '1分前',
    sessions: [],
    worktrees: [],
    conflicts: [],
    areas: ['認証'],
    ...partial,
  }
}
