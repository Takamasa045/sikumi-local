import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GardenInspect } from './GardenInspect'

describe('GardenInspect', () => {
  it('shows a traveling employee and closes on Escape', async () => {
    const onClose = vi.fn()
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'サグル',
          role: '調査担当',
          station: 'archive',
          traveling: true,
          summary: 'この工房の資料を読んでいます',
          jobTitle: '調査',
          operatorSummary: 'Codexが動かしている',
        }}
        onClose={onClose}
      />,
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      '資料棚へ向かっています',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'Codexが動かしている',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('調査')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows how far a stopped agent got without inventing the next step', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'ブログ番',
          station: 'waiting',
          traveling: false,
          summary: '見出しの直し',
          repositoryLabel: 'my-blog',
          operatorSummary: 'Claude Codeが確認を待っています',
          stopped: true,
          progressSummary: '見出しの直し',
          nextStepSummary: null,
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('リポジトリ')
    expect(inspect).toHaveTextContent('my-blog')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('見出しの直し')
    expect(inspect).toHaveTextContent('次はこんな感じか')
    expect(inspect).toHaveTextContent('まだ分かっていません')
    expect(inspect).not.toHaveTextContent('いまの仕事')
  })

  it('lists occupant summaries on a station', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'station',
          station: 'workbench',
          occupants: [
            {
              name: 'サグル',
              traveling: false,
              summary: '作業台で整理しています',
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'サグルが作業台にいます',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'サグル：作業台で整理しています',
    )
  })
})
