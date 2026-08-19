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
        }}
        onClose={onClose}
      />,
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      '資料棚へ向かっています',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('調査')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows place progress in everyday words when the copy is given', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'ブログ番',
          station: 'workbench',
          traveling: false,
          summary: 'APIを直している',
          nowText: '動いている / APIを直している',
          implementationLook: '作業中のファイルが2 / 画面あたり',
          nextStep: null,
          driverNote: 'Codexが動かしている',
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('ブログ番')
    expect(inspect).toHaveTextContent('いま')
    expect(inspect).toHaveTextContent('動いている / APIを直している')
    expect(inspect).toHaveTextContent('Codexが動かしている')
    expect(inspect).toHaveTextContent('実装の様子')
    expect(inspect).toHaveTextContent('作業中のファイルが2')
    expect(inspect).toHaveTextContent('画面あたり')
    expect(inspect).not.toHaveTextContent('これから')
    expect(inspect).not.toHaveTextContent('いまの作業の続き')
    expect(inspect).not.toHaveTextContent('役割')
    expect(inspect).not.toHaveTextContent('要約')
  })

  it('uses stopped words for progress and next when the character is still', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'notes番',
          station: 'rest',
          traveling: false,
          summary: '',
          nowText: '作業中のファイルが1 / 画面あたり',
          implementationLook: '作業中のファイルが1 / 画面あたり',
          nextStep: null,
          live: false,
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('作業中のファイルが1')
    expect(inspect).toHaveTextContent('画面あたり')
    expect(inspect).not.toHaveTextContent('まだ分かっていません')
    expect(inspect).not.toHaveTextContent('次に動かすまで待つ')
    const labels = [...inspect.querySelectorAll('dt')].map(
      (item) => item.textContent,
    )
    expect(labels).toContain('どこまでやったか')
    expect(labels).not.toContain('次はこんな感じか')
    expect(labels).not.toContain('いま')
    expect(labels).not.toContain('これから')
    expect(inspect).not.toHaveTextContent('変更元不明')
  })

  it('omits unknown boilerplate instead of inventing missing facts', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'notes番',
          station: 'rest',
          traveling: false,
          summary: 'まだ分かっていません',
          nowText: '静か。まだ分かっていません',
          implementationLook: 'まだ分かっていません',
          nextStep: '次に動かすまで待つ',
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).not.toHaveTextContent('まだ分かっていません')
    expect(inspect).not.toHaveTextContent('実装の様子')
    expect(inspect).not.toHaveTextContent('次に動かすまで待つ')
    expect(inspect).not.toHaveTextContent('変更元不明')
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
