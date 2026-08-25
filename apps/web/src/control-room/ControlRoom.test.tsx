import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ControlRoom } from './ControlRoom'
import { sampleSnapshot, twoAgentsNoConflictSnapshot } from './test-snapshot'

describe('ControlRoom', () => {
  it('shows today’s summary, waiting, conflict, and running work', () => {
    render(
      <ControlRoom
        snapshot={sampleSnapshot()}
        selectedKind={null}
        selectedId={null}
        showTechnical={false}
        technical={null}
        busy={false}
        onSelectPlace={vi.fn()}
        onSelectWork={vi.fn()}
        onSelectAttention={vi.fn()}
        onToggleTechnical={vi.fn()}
        onAcknowledge={vi.fn()}
        onCloseDetail={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'いまの様子' })).toBeVisible()
    const summary = screen.getByTestId('control-room-summary')
    expect(summary).toHaveTextContent('動いているAI 2')
    expect(summary).toHaveTextContent('場所 1')
    expect(summary).toHaveTextContent('注意 2')
    expect(summary).toHaveTextContent('確認待ち 1')

    const attention = screen.getByRole('region', { name: '確認が必要' })
    expect(
      within(attention).getByText('同じファイルを書いています'),
    ).toBeVisible()
    expect(
      within(attention).getByTestId(
        'control-room-attention-conflict:same-file',
      ),
    ).toHaveAttribute('data-severity', 'red')
    expect(within(attention).getByText('確認待ち')).toBeVisible()
    expect(
      within(attention).getByTestId(
        'control-room-attention-waiting:repo-a:codex',
      ),
    ).toHaveAttribute('data-severity', 'yellow')

    const works = screen.getByRole('region', { name: '動いている仕事' })
    expect(within(works).getByText('alpha')).toBeVisible()
    expect(within(works).getByText('Codexが、ログイン画面の直し')).toBeVisible()
    expect(
      within(works).getByText('Cursorが、ログイン画面の直し'),
    ).toBeVisible()
    expect(within(works).queryByText('src/auth.ts')).toBeNull()
    expect(within(works).queryByText('Grok 2')).toBeNull()
    expect(within(works).queryByText('fake-claude')).toBeNull()
    expect(within(works).queryByText('変更元不明')).toBeNull()
    expect(within(works).queryByText('縁側')).toBeNull()
    expect(within(works).queryByText(/a1b2c3d/)).toBeNull()

    const health = screen.getByRole('region', { name: '観測の健康' })
    expect(within(health).getByText(/Codex/)).toBeVisible()
    expect(within(health).queryByText('Cursor')).toBeNull()

    expect(screen.queryByRole('button', { name: '起動' })).toBeNull()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'commit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'push' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'merge' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'kill' })).toBeNull()
    expect(screen.queryByRole('button', { name: '仕事を頼む' })).toBeNull()
  })

  it('does not warn just because two AIs work in the same place', () => {
    render(
      <ControlRoom
        snapshot={twoAgentsNoConflictSnapshot()}
        selectedKind={null}
        selectedId={null}
        showTechnical={false}
        technical={null}
        busy={false}
        onSelectPlace={vi.fn()}
        onSelectWork={vi.fn()}
        onSelectAttention={vi.fn()}
        onToggleTechnical={vi.fn()}
        onAcknowledge={vi.fn()}
        onCloseDetail={vi.fn()}
      />,
    )

    expect(screen.queryByText('同じファイルを書いています')).toBeNull()
    expect(screen.queryByTestId(/control-room-attention-/)).toBeNull()
    expect(screen.getByText('いま確認することはありません')).toBeVisible()
    expect(screen.getByText('Codexが、ログイン画面の直し')).toBeVisible()
    expect(screen.getByText('Cursorが、テストを書いている')).toBeVisible()
    expect(screen.queryByRole('region', { name: '観測の健康' })).toBeNull()
  })

  it('opens place and work looks, and keeps technical details closed', async () => {
    const onSelectWork = vi.fn()
    const onSelectPlace = vi.fn()
    const onToggleTechnical = vi.fn()
    const snapshot = sampleSnapshot()
    const { rerender } = render(
      <ControlRoom
        snapshot={snapshot}
        selectedKind={null}
        selectedId={null}
        showTechnical={false}
        technical={null}
        busy={false}
        onSelectPlace={onSelectPlace}
        onSelectWork={onSelectWork}
        onSelectAttention={vi.fn()}
        onToggleTechnical={onToggleTechnical}
        onAcknowledge={vi.fn()}
        onCloseDetail={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'alpha' }))
    expect(onSelectPlace).toHaveBeenCalledWith('repo-a')

    rerender(
      <ControlRoom
        snapshot={snapshot}
        selectedKind="place"
        selectedId="repo-a"
        showTechnical={false}
        technical={{
          branch: 'feat/login',
          worktreePath: '/tmp/repo-a',
          commit: 'a1b2c3d4e5f6',
        }}
        busy={false}
        onSelectPlace={onSelectPlace}
        onSelectWork={onSelectWork}
        onSelectAttention={vi.fn()}
        onToggleTechnical={onToggleTechnical}
        onAcknowledge={vi.fn()}
        onCloseDetail={vi.fn()}
      />,
    )

    const detail = screen.getByRole('region', { name: '場所の様子' })
    expect(within(detail).getByText('alpha')).toBeVisible()
    expect(within(detail).getByText('いま')).toBeVisible()
    expect(within(detail).getByText('次')).toBeVisible()
    expect(within(detail).getByText('注意')).toBeVisible()
    expect(within(detail).queryByText('feat/login')).toBeNull()
    expect(within(detail).queryByText('/tmp/repo-a')).toBeNull()
    expect(within(detail).queryByText('a1b2c3d4e5f6')).toBeNull()

    await userEvent.click(
      screen.getByRole('button', { name: 'Codexが、ログイン画面の直し' }),
    )
    expect(onSelectWork).toHaveBeenCalledWith('codex-a')

    rerender(
      <ControlRoom
        snapshot={snapshot}
        selectedKind="work"
        selectedId="codex-a"
        showTechnical={false}
        technical={{
          branch: 'feat/login',
          worktreePath: '/tmp/repo-a',
          commit: 'a1b2c3d4e5f6',
        }}
        busy={false}
        onSelectPlace={onSelectPlace}
        onSelectWork={onSelectWork}
        onSelectAttention={vi.fn()}
        onToggleTechnical={onToggleTechnical}
        onAcknowledge={vi.fn()}
        onCloseDetail={vi.fn()}
      />,
    )

    const workDetail = screen.getByRole('region', { name: '仕事の様子' })
    expect(within(workDetail).getByText('いま')).toBeVisible()
    expect(within(workDetail).getByText('次')).toBeVisible()
    expect(within(workDetail).getByText('注意')).toBeVisible()
    expect(
      within(workDetail).getByText(
        '同じ場所で、Cursorもログイン画面の直しをしています',
      ),
    ).toBeVisible()
    expect(within(workDetail).queryByText('feat/login')).toBeNull()

    await userEvent.click(
      within(workDetail).getByRole('button', { name: '技術の詳細を見る' }),
    )
    expect(onToggleTechnical).toHaveBeenCalled()
  })

  it('lets the human mark attention as seen', async () => {
    const onAcknowledge = vi.fn()
    render(
      <ControlRoom
        snapshot={sampleSnapshot()}
        selectedKind={null}
        selectedId={null}
        showTechnical={false}
        technical={null}
        busy={false}
        onSelectPlace={vi.fn()}
        onSelectWork={vi.fn()}
        onSelectAttention={vi.fn()}
        onToggleTechnical={vi.fn()}
        onAcknowledge={onAcknowledge}
        onCloseDetail={vi.fn()}
      />,
    )

    await userEvent.click(
      screen.getAllByRole('button', { name: '確認した' })[0]!,
    )
    expect(onAcknowledge).toHaveBeenCalledWith('conflict:same-file')
  })
})
