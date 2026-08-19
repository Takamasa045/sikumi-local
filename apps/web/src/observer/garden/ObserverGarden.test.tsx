import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TodayOverview } from '../../api/observer'
import { ObserverGarden } from './ObserverGarden'

type RepositoryView = TodayOverview['repositories'][number]
type SessionView = RepositoryView['sessions'][number]

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
          }),
        ]),
        repository('repo_b', 'beta', [
          session({
            id: 'shared',
            source: 'cursor',
            displayName: 'Cursor',
            title: 'betaの修正',
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

  it('maps remaining tones, unnamed sessions, and known sources', async () => {
    const onWorkshop = vi.fn()
    const onSettings = vi.fn()
    render(
      <ObserverGarden
        overview={overviewOf([
          repository('repo_a', 'alpha', [
            session({
              id: 'done',
              source: 'copilot',
              displayName: '   ',
              title: '',
              status: 'finished',
              activity: 'idle',
            }),
            session({
              id: 'obs',
              source: null as never,
              displayName: '',
              title: '観測だけ',
              status: 'idle',
              activity: 'idle',
            }),
            session({
              id: 'vs',
              source: 'vscode',
              displayName: 'VS Code',
              title: '編集',
              status: 'completed',
              activity: 'done',
            }),
          ]),
        ])}
        onOpenWorkshop={onWorkshop}
        onOpenSettings={onSettings}
      />,
    )
    expect(screen.getAllByText('完了')).toHaveLength(2)
    expect(screen.getByText('観測中')).toBeVisible()
    expect(screen.getByText('無題')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /今日の作業場/ }))
    expect(onWorkshop).toHaveBeenCalled()
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
