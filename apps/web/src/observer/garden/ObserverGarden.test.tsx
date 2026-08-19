import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKING_WALK_FIRST_STEP_MS, WORKING_WALK_STOPS } from './gardenWalk'
import type { Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import { ObserverGarden } from './ObserverGarden'

type RepositoryView = TodayOverview['repositories'][number]
type SessionView = RepositoryView['sessions'][number]

afterEach(() => {
  vi.useRealTimers()
})

describe('ObserverGarden', () => {
  it('shows registered places as ○○番 characters, not tool dogs or a list', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'my-blog', [
          session({
            id: 's1',
            source: 'codex',
            displayName: 'Codex',
            title: 'APIを直している',
            status: 'running',
            activity: 'working',
            lastObservedLabel: '3分前',
          }),
          session({
            id: 's2',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: 'テストを書いている',
            status: 'active',
            activity: 'active',
            lastObservedLabel: '1分前',
          }),
        ]),
        repository('repo_b', 'notes', []),
      ]),
      [workspace('ws_repo_a', 'ブログ番')],
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getByText('ブログ番')).toBeVisible()
    expect(within(residents).getByText('APIを直している')).toBeVisible()
    expect(within(residents).getByText('notes番')).toBeVisible()
    expect(within(residents).getByText('まだ分かっていません')).toBeVisible()
    expect(within(residents).queryByText('Codex')).toBeNull()
    expect(within(residents).queryByText('Claude Code')).toBeNull()
    expect(screen.queryByRole('region', { name: '○○番の一覧' })).toBeNull()
    expect(screen.queryByTestId('garden-employee')).toBeNull()
    expect(screen.queryByText('サグル')).toBeNull()
    expect(
      screen.queryByRole('list', { name: '出どころ未確認の変更' }),
    ).toBeNull()
  })

  it('keeps one character per registered place even when idle', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', []),
        repository('repo_b', 'beta', []),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getAllByRole('listitem')).toHaveLength(2)
    expect(within(residents).getByText('alpha番')).toBeVisible()
    expect(within(residents).getByText('beta番')).toBeVisible()
    expect(within(residents).getAllByText('まだ分かっていません')).toHaveLength(
      2,
    )
    const items = within(residents).getAllByRole('listitem')
    expect(
      items.every(
        (item) => item.getAttribute('data-station') !== 'observatory',
      ),
    ).toBe(true)
    expect(
      items.every((item) => item.getAttribute('data-station') !== 'archive'),
    ).toBe(true)
    const groundXs = items.map((item) => item.getAttribute('data-ground-x'))
    expect(new Set(groundXs).size).toBe(2)
    expect(groundXs.every((value) => Number(value) >= 36)).toBe(true)
  })

  it('does not use git or inferred work as the job name', () => {
    renderGarden(
      overviewOf([
        repository(
          'repo_a',
          'alpha',
          [
            session({
              id: 'git',
              source: 'git',
              displayName: 'Git作業',
              title: '変更元不明の作業',
              attributionConfidence: 'observed',
            }),
            session({
              id: 'guess',
              source: 'codex',
              displayName: 'Codexらしい',
              title: '推測された作業',
              attributionConfidence: 'inferred',
            }),
          ],
          4,
        ),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getByText('alpha番')).toBeVisible()
    expect(within(residents).getByText('まだ分かっていません')).toBeVisible()
    expect(within(residents).queryByText('変更元不明の作業')).toBeNull()
    expect(within(residents).queryByText('Git作業')).toBeNull()
    expect(within(residents).queryByText('Codexらしい')).toBeNull()
    expect(
      screen.queryByRole('list', { name: '出どころ未確認の変更' }),
    ).toBeNull()
  })

  it('shows the empty garden when no place is registered', () => {
    renderGarden(overviewOf([]))

    expect(
      screen.getByText(
        '登録した場所がまだありません。今日の作業場からフォルダを追加してください。',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('list', { name: '庭の住人' })).toBeNull()
    expect(screen.queryByRole('region', { name: '○○番の一覧' })).toBeNull()

    renderGarden(null)
    expect(
      screen.getAllByText(
        '登録した場所がまだありません。今日の作業場からフォルダを追加してください。',
      ).length,
    ).toBeGreaterThan(0)
  })

  it('names shikumi places しくみローカル番', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'sikumi-local', []),
        repository('repo_b', 'my-shikumi-notes', []),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getAllByText('しくみローカル番')).toHaveLength(2)
  })

  it('opens current work in place without turning a tool into an employee', async () => {
    renderGarden(
      overviewOf([
        repository(
          'repo_a',
          'alpha',
          [
            session({
              id: 's1',
              source: 'codex',
              displayName: 'Codex',
              title: 'APIを直している',
              status: 'running',
              activity: 'working',
            }),
          ],
          2,
          ['画面'],
        ),
      ]),
    )

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('alpha番')
    expect(inspect).toHaveTextContent('いま')
    expect(inspect).toHaveTextContent('動いている。APIを直している')
    expect(inspect).toHaveTextContent('実装の様子')
    expect(inspect).toHaveTextContent('作業中のファイル')
    expect(inspect).toHaveTextContent('これから')
    expect(inspect).toHaveTextContent('いまの作業の続き')
    expect(inspect).toHaveTextContent('Codexが動かしている')
    expect(inspect).toHaveTextContent(/資料棚|作業台|確認の場所/)
    expect(inspect.querySelector('.garden-inspect__title')).toHaveTextContent(
      'alpha番',
    )
    expect(inspect).not.toHaveTextContent('望遠鏡')
    expect(screen.queryByTestId('garden-employee')).toBeNull()
    expect(
      screen.queryByRole('heading', { name: 'いま何が、どこで起きているか' }),
    ).toBeNull()
  })

  it('hides idle sessions and does not put residents on the observatory', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 'kids',
            source: 'cursor',
            displayName: 'エージェントワークフローキッズ版',
            title: '作業',
            status: 'idle',
            activity: 'idle',
          }),
          session({
            id: 'live',
            source: 'codex',
            displayName: 'Codex',
            title: 'Codexの作業が始まりました',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(
      within(residents).queryByText('エージェントワークフローキッズ版'),
    ).toBeNull()
    expect(within(residents).getByText('まだ分かっていません')).toBeVisible()
    expect(
      within(residents).queryByText('Codexの作業が始まりました'),
    ).toBeNull()
    expect(within(residents).getByRole('listitem')).toHaveAttribute(
      'data-station',
      'workbench',
    )
    expect(
      within(residents).queryByRole('listitem', { name: /望遠鏡/ }),
    ).toBeNull()
    expect(within(residents).getByRole('listitem')).not.toHaveAttribute(
      'data-station',
      'observatory',
    )
  })

  it('says the work is unknown when no real title remains', async () => {
    renderGarden(
      overviewOf([
        repository('repo_a', '', [
          session({
            id: 's1',
            source: 'codex',
            displayName: 'Codex',
            title: 'Codexの様子が届きました',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getByText('まだ分かっていません')).toBeVisible()
    await userEvent.click(within(residents).getByRole('button'))
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'まだ分かっていません',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'いまの作業の続き',
    )
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('望遠鏡')
  })

  it('explains a station in place when it is clicked', async () => {
    renderGarden(null)

    await userEvent.click(screen.getByRole('button', { name: '資料棚' }))
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'この工房の資料を読む場所',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      '資料棚に、いまは誰もいません',
    )
  })

  it('names the waiting place in picture words', async () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 'wait',
            source: 'claude-desktop',
            displayName: 'Claudeアプリ',
            title: '承認が必要',
            status: 'idle',
            activity: 'waiting',
          }),
        ]),
      ]),
    )

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('確認の場所')
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      '確認待ち。承認が必要',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('確認が必要')
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'Claudeアプリが動かしている',
    )
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('望遠鏡')
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('確認札')
    expect(screen.getByTestId('garden-place-repo_a')).toHaveAttribute(
      'data-station',
      'waiting',
    )
    const labels = [
      ...screen.getByTestId('garden-inspect').querySelectorAll('dt'),
    ].map((item) => item.textContent)
    expect(labels).toContain('どこまでやったか')
    expect(labels).toContain('次はこんな感じか')
    expect(labels).not.toContain('いま')
  })

  it('walks a working character between the shelf, bench, and check place', async () => {
    vi.useFakeTimers()
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 's1',
            source: 'codex',
            displayName: 'Codex',
            title: 'APIを直している',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    const actor = screen.getByTestId('garden-place-repo_a')
    const firstStop = actor.getAttribute('data-walk-stop')
    expect(actor).toHaveAttribute('data-station', 'workbench')
    expect(actor).toHaveAttribute('data-status', 'working')
    expect(actor).toHaveAttribute('data-traveling', 'false')
    expect(WORKING_WALK_STOPS).toContain(firstStop)

    await act(async () => {
      vi.advanceTimersByTime(WORKING_WALK_FIRST_STEP_MS + 20)
    })

    expect(actor).toHaveAttribute('data-traveling', 'true')
    expect(actor).toHaveAttribute('data-gesture', 'walking')
    const nextStop = actor.getAttribute('data-walk-stop')
    expect(nextStop).not.toBe(firstStop)
    expect(WORKING_WALK_STOPS).toContain(nextStop)
    expect(actor.getAttribute('data-station')).toBe('workbench')
  })

  it('shows the repository name on the bubble when ○○番 does not already name it', () => {
    renderGarden(overviewOf([repository('repo_a', 'my-blog', [])]), [
      workspace('ws_repo_a', 'ブログ番'),
    ])

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getByText('ブログ番')).toBeVisible()
    expect(within(residents).getByText('my-blog')).toBeVisible()
    expect(within(residents).getByText('まだ分かっていません')).toBeVisible()
  })

  it('shows how far a still place got and what is next, without inventing', async () => {
    renderGarden(overviewOf([repository('repo_a', 'notes', [], 1, ['画面'])]))

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('静か。まだ分かっていません')
    expect(inspect).toHaveTextContent('作業中のファイルが1つある')
    expect(inspect).toHaveTextContent('次はこんな感じか')
    expect(inspect).toHaveTextContent('次に動かすまで待つ')
    const labels = [...inspect.querySelectorAll('dt')].map(
      (item) => item.textContent,
    )
    expect(labels).not.toContain('いま')
    expect(labels).not.toContain('これから')
    expect(inspect).not.toHaveTextContent('変更元不明')
  })
})

function renderGarden(
  overview: TodayOverview | null,
  workspaces: Workspace[] = [],
) {
  return render(
    <ObserverGarden
      overview={overview}
      workspaces={workspaces}
      onOpenWorkshop={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  )
}

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
  changedFileCount = 0,
  areas: readonly string[] = [],
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
    areas: [...areas],
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

function workspace(id: string, employeeName?: string): Workspace {
  return {
    id,
    name: id,
    ...(employeeName ? { employeeName } : {}),
    defaultProviderId: null,
    worldPackId: 'dog-office',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
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
