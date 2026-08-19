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
          nowText: '動いている\nAPIを直している',
          implementationLook:
            '記録する前の、途中の仕事です\n途中の仕事が2\n画面あたり',
          nextStep: null,
          driverNote: 'Codexが動かしている',
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('ブログ番')
    expect(inspect).toHaveTextContent('いま')
    expect(inspect).toHaveTextContent('動いている')
    expect(inspect).toHaveTextContent('APIを直している')
    expect(inspect).not.toHaveTextContent(' / ')
    expect(inspect).toHaveTextContent('Codexが動かしている')
    expect(inspect).toHaveTextContent('実装の様子')
    expect(inspect).toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).toHaveTextContent('途中の仕事が2')
    expect(inspect).toHaveTextContent('画面あたり')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
    expect(inspect).not.toHaveTextContent('作業中のファイル')
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
          nowText: null,
          implementationLook:
            '記録する前の、途中の仕事です\n途中の仕事が1\n画面あたり',
          nextStep: null,
          live: false,
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).toHaveTextContent('途中の仕事が1')
    expect(inspect).toHaveTextContent('画面あたり')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
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

  it('lists leftover pieces by area instead of a slash string', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'hataraki番',
          station: 'rest',
          traveling: false,
          summary: '画面や確認まわりに、途中の仕事がある',
          nowText: null,
          implementationLook: '記録する前の、途中の仕事です\n途中の仕事が18',
          leftoverWork: {
            groups: [
              {
                areaLabel: '画面',
                names: ['App.tsx', 'Office.tsx', 'styles.css'],
              },
              {
                areaLabel: '確認用の仕組み',
                names: [
                  'garden.spec.ts',
                  'observer.spec.ts',
                  'visual-qa.spec.ts',
                ],
              },
              { areaLabel: 'そのほか', names: ['README.md', 'server', 'live'] },
            ],
            more: true,
          },
          nextStep: null,
          live: false,
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).toHaveTextContent('途中の仕事が18')
    expect(inspect).toHaveTextContent('画面')
    expect(inspect).toHaveTextContent('Office.tsx')
    expect(inspect).toHaveTextContent('確認用の仕組み')
    expect(inspect).toHaveTextContent('garden.spec.ts')
    expect(inspect).toHaveTextContent('README.md')
    expect(inspect).toHaveTextContent('ほかにもある')
    expect(inspect).not.toHaveTextContent(' / ')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
    expect(
      inspect.querySelectorAll('.garden-inspect__leftover-files li'),
    ).toHaveLength(9)
  })

  it('does not invent leftover files when none remain', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'notes番',
          station: 'rest',
          traveling: false,
          summary: '',
          nowText: '静か',
          implementationLook: null,
          leftoverWork: null,
          nextStep: null,
          live: false,
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).not.toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).not.toHaveTextContent('途中の仕事')
    expect(inspect).not.toHaveTextContent('ほかにもある')
    expect(inspect.querySelector('.garden-inspect__leftover')).toBeNull()
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
