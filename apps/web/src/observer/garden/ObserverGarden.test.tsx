import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import { ObserverGarden } from './ObserverGarden'

type RepositoryView = TodayOverview['repositories'][number]
type SessionView = RepositoryView['sessions'][number]

afterEach(() => {
  vi.useRealTimers()
})

describe('ObserverGarden', () => {
  it('shows Codex and Claude Code agents at the same time', () => {
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
      ]),
    )

    const agents = screen.getByRole('list', { name: '観測中のエージェント' })
    expect(within(agents).getAllByText('Codex')).toHaveLength(2)
    expect(within(agents).getAllByText('Claude Code')).toHaveLength(2)
    expect(within(agents).getByText('APIを直している')).toBeVisible()
    expect(within(agents).getByText('テストを書いている')).toBeVisible()
    expect(within(agents).getAllByText('alpha')).toHaveLength(2)
    expect(within(agents).getByText('3分前')).toBeVisible()
    expect(within(agents).getByText('1分前')).toBeVisible()
    expect(within(agents).getAllByText('作業中')).toHaveLength(2)
  })

  it('keeps the same session id distinct across repositories', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 'shared',
            source: 'cursor',
            displayName: 'Cursor',
            title: 'alphaの修正',
            status: 'running',
            activity: 'working',
          }),
        ]),
        repository('repo_b', 'beta', [
          session({
            id: 'shared',
            source: 'cursor',
            displayName: 'Cursor',
            title: 'betaの修正',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    const agents = screen.getByRole('list', { name: '観測中のエージェント' })
    expect(within(agents).getByText('alphaの修正')).toBeVisible()
    expect(within(agents).getByText('betaの修正')).toBeVisible()
    expect(within(agents).getAllByText('Cursor')).toHaveLength(4)
    expect(within(agents).getByText('alpha')).toBeVisible()
    expect(within(agents).getByText('beta')).toBeVisible()
  })

  it('separates git and inferred sessions from observed agents', () => {
    renderGarden(
      overviewOf([
        repository(
          'repo_a',
          'alpha',
          [
            session({
              id: 'agent',
              source: 'grok',
              displayName: 'Grok Build',
              title: '庭を整えている',
              status: 'running',
              activity: 'working',
            }),
            session({
              id: 'git',
              source: 'git',
              displayName: 'Git作業',
              title: '未帰属の差分',
              attributionConfidence: 'observed',
            }),
          ],
          4,
        ),
        repository(
          'repo_b',
          'beta',
          [
            session({
              id: 'guess',
              source: 'codex',
              displayName: 'Codexらしい',
              title: '推測された作業',
              attributionConfidence: 'inferred',
            }),
          ],
          2,
        ),
      ]),
    )

    const agents = screen.getByRole('list', { name: '観測中のエージェント' })
    expect(within(agents).getAllByText('Grok Build')).toHaveLength(2)
    expect(within(agents).getByText('庭を整えている')).toBeVisible()
    expect(within(agents).queryByText('Git作業')).toBeNull()
    expect(within(agents).queryByText('未帰属の差分')).toBeNull()
    expect(within(agents).queryByText('Codexらしい')).toBeNull()
    expect(within(agents).queryByText('推測された作業')).toBeNull()

    const unverified = screen.getByRole('list', {
      name: '出どころ未確認の変更',
    })
    expect(within(unverified).getByText('alpha')).toBeVisible()
    expect(within(unverified).getByText('beta')).toBeVisible()
    expect(
      within(unverified).getAllByText('出どころ未確認の変更'),
    ).toHaveLength(2)
    expect(within(unverified).getByText('4 件')).toBeVisible()
    expect(within(unverified).getByText('2 件')).toBeVisible()
  })

  it('shows the empty garden when no external sessions exist', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 'git',
            source: 'git',
            displayName: 'Git作業',
            attributionConfidence: 'observed',
          }),
        ]),
      ]),
    )

    expect(
      screen.getByText(
        '各AIアプリで作業を始めると、観測できたエージェントがここに現れます',
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('list', { name: '観測中のエージェント' }),
    ).toBeNull()

    renderGarden(null)
    expect(
      screen.getAllByText(
        '各AIアプリで作業を始めると、観測できたエージェントがここに現れます',
      ).length,
    ).toBeGreaterThan(0)
  })

  it('labels waiting status as 確認待ち', () => {
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

    const agent = screen.getByRole('listitem')
    expect(within(agent).getByText('確認待ち')).toBeVisible()
    expect(agent).toHaveAttribute('data-status', 'waiting')
    expect(within(agent).getAllByText('Claudeアプリ')).toHaveLength(2)
  })

  it('does not invent a brand for an unknown source', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 'mystery',
            source: 'mystery-bot',
            displayName: '実験用ツール',
            title: '未知の作業',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    const agents = screen.getByRole('list', { name: '観測中のエージェント' })
    expect(within(agents).getAllByText('実験用ツール')).toHaveLength(2)
    expect(within(agents).queryByText('mystery-bot')).toBeNull()
    expect(within(agents).queryByText('Codex')).toBeNull()
    expect(within(agents).queryByText('Claude Code')).toBeNull()
    expect(within(agents).queryByText('Grok Build')).toBeNull()
    expect(within(agents).queryByText('Cursor')).toBeNull()
    expect(within(agents).queryByText('Claudeアプリ')).toBeNull()
  })

  it('lets a user open what Saguru is doing without leaving the garden', async () => {
    renderGarden(null)

    await userEvent.click(screen.getByTestId('garden-employee'))
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('サグル')
    expect(inspect).toHaveTextContent('調査担当')
    expect(inspect).toHaveTextContent('縁側にいます')
    expect(inspect).toHaveTextContent('まだ仕事は始まっていません')
    expect(screen.getByRole('heading', { name: '観測の庭' })).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'いま何が、どこで起きているか' }),
    ).toBeNull()
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

  it('walks Saguru to the next job station', async () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <ObserverGarden
        overview={null}
        employeeName="サグル"
        employeeRole="調査担当"
        presence={{
          station: 'rest',
          pose: 'idle',
          summary: 'まだ仕事は始まっていません',
          stateName: 'idle',
        }}
        onOpenWorkshop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    const employee = screen.getByTestId('garden-employee')
    expect(employee).toHaveAttribute('data-station', 'rest')
    expect(employee).toHaveAttribute('data-traveling', 'false')

    rerender(
      <ObserverGarden
        overview={null}
        employeeName="サグル"
        employeeRole="調査担当"
        presence={{
          station: 'archive',
          pose: 'reading',
          summary: 'この工房の資料を読んでいます',
          stateName: 'reading_repository',
        }}
        onOpenWorkshop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    expect(employee).toHaveAttribute('data-station', 'archive')
    expect(employee).toHaveAttribute('data-traveling', 'true')
    expect(employee).toHaveAttribute('data-gesture', 'walking')
    expect(employee).toHaveStyle({ left: '13%', top: '22%' })

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(employee).toHaveAttribute('data-traveling', 'false')
    expect(employee).toHaveAttribute('data-gesture', 'working')
    vi.useRealTimers()
  })

  it('opens observed work in place without turning a tool into an employee', async () => {
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

    const agents = screen.getByRole('list', { name: '観測中のエージェント' })
    await userEvent.click(within(agents).getByRole('button'))
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('Codex')
    expect(inspect).toHaveTextContent('作業中')
    expect(inspect).toHaveTextContent('APIを直している')
    expect(inspect).toHaveTextContent('作業台')
    expect(inspect).not.toHaveTextContent('望遠鏡')
    expect(screen.getByTestId('garden-employee')).toHaveTextContent('サグル')
    expect(
      screen.queryByRole('heading', { name: 'いま何が、どこで起きているか' }),
    ).toBeNull()
  })

  it('hides idle sessions and does not put live dogs on the observatory', () => {
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

    const agents = screen.getByRole('list', { name: '観測中のエージェント' })
    expect(within(agents).queryByText('エージェントワークフローキッズ版')).toBeNull()
    expect(within(agents).getByText('alphaが対象です')).toBeVisible()
    expect(within(agents).queryByText('Codexの作業が始まりました')).toBeNull()
    expect(screen.getByRole('listitem')).toHaveAttribute('data-station', 'workbench')
    expect(screen.queryByRole('listitem', { name: /望遠鏡/ })).toBeNull()
  })

  it('says the work is unknown when no real title or repository remains', async () => {
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

    const agents = screen.getByRole('list', { name: '観測中のエージェント' })
    expect(within(agents).getByText('仕事の内容はまだ分かっていません')).toBeVisible()
    await userEvent.click(within(agents).getByRole('button'))
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      '仕事の内容はまだ分かっていません',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('作業台')
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('望遠鏡')
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

    await userEvent.click(within(screen.getByRole('listitem')).getByRole('button'))
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('確認の場所')
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('望遠鏡')
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('確認札')
  })

  it('keeps Saguru put when the station does not change', async () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <ObserverGarden
        overview={null}
        employeeName="サグル"
        employeeRole="調査担当"
        presence={{
          station: 'rest',
          pose: 'idle',
          summary: 'まだ仕事は始まっていません',
          stateName: 'idle',
        }}
        onOpenWorkshop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    rerender(
      <ObserverGarden
        overview={null}
        employeeName="サグル"
        employeeRole="調査担当"
        presence={{
          station: 'rest',
          pose: 'idle',
          summary: '仕事の準備をしています',
          stateName: 'idle',
        }}
        onOpenWorkshop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    )
    expect(screen.getByTestId('garden-employee')).toHaveAttribute(
      'data-traveling',
      'false',
    )
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByTestId('garden-employee')).toHaveAttribute(
      'data-traveling',
      'false',
    )
    vi.useRealTimers()
  })
})

function renderGarden(overview: TodayOverview | null) {
  return render(
    <ObserverGarden
      overview={overview}
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
    lastObservedAt: '2026-08-19T00:00:00.000Z',
    lastObservedLabel: null,
    ...partial,
  }
}
