import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GardenInspect } from './GardenInspect'

describe('GardenInspect', () => {
  it('caps the beige inspect panel so long copy scrolls inside', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'サグル',
          role: '調査担当',
          station: 'archive',
          traveling: false,
          summary: 'この工房の資料を読んでいます',
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveClass('garden-inspect')
    expect(inspect.querySelector('.garden-inspect__head')).not.toBeNull()
    expect(inspect.querySelector('.garden-inspect__body')).not.toBeNull()
  })

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
      '資料のところへ向かっています',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('調査')
    expect(
      screen.getByTestId('garden-inspect').querySelector('.garden-inspect__head'),
    ).not.toBeNull()
    expect(
      screen.getByTestId('garden-inspect').querySelector('.garden-inspect__body'),
    ).not.toBeNull()
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
          nowText:
            'APIを直している\n画面の途中が残っています。\n最後に見えたのは1分前',
          implementationLook: null,
          nextStep: null,
          goal: 'APIを直している',
          driverNote: 'Codexが動かしている',
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('ブログ番')
    expect(inspect).toHaveTextContent('いま')
    expect(inspect).toHaveTextContent('いまの仕事')
    expect(inspect).toHaveTextContent('APIを直している')
    expect(inspect).toHaveTextContent('画面の途中が残っています。')
    expect(inspect).toHaveTextContent('作業しています')
    expect(inspect).not.toHaveTextContent('縁側')
    expect(inspect).toHaveTextContent('最後に見えたのは1分前')
    expect(inspect).not.toHaveTextContent(' / ')
    expect(inspect).toHaveTextContent('Codexが動かしている')
    expect(inspect).not.toHaveTextContent('実装の様子')
    expect(inspect).not.toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).not.toHaveTextContent('途中の仕事が2')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
    expect(inspect).not.toHaveTextContent('作業中のファイル')
    expect(inspect).not.toHaveTextContent('これから')
    expect(inspect).not.toHaveTextContent('いまの作業の続き')
    expect(inspect).not.toHaveTextContent('役割')
    expect(inspect).not.toHaveTextContent('要約')
  })

  it('uses stopped words for the last-state summary when the character is still', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'notes番',
          station: 'rest',
          traveling: false,
          summary: '',
          nowText: '画面の途中が残っています。',
          implementationLook: null,
          nextStep: null,
          live: false,
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('画面の途中が残っています。')
    expect(inspect).not.toHaveTextContent('縁側')
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

  it('summarizes leftover work without listing engineer file names', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'しくみローカル番',
          station: 'rest',
          traveling: false,
          summary: '道具や画面まわりに、途中の仕事がある',
          nowText:
            '道具と画面の途中が残っています。\n最後に見えたのは4時間前',
          implementationLook: null,
          nextStep: null,
          live: false,
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('道具と画面の途中が残っています。')
    expect(inspect).not.toHaveTextContent('縁側')
    expect(inspect).toHaveTextContent('最後に見えたのは4時間前')
    expect(inspect).not.toHaveTextContent('Office.tsx')
    expect(inspect).not.toHaveTextContent('observer.ts')
    expect(inspect).not.toHaveTextContent('app.css')
    expect(inspect).not.toHaveTextContent('schema.ts')
    expect(inspect).not.toHaveTextContent('package.json')
    expect(inspect).not.toHaveTextContent('AdapterSettings.tsx')
    expect(inspect).not.toHaveTextContent('データの形')
    expect(inspect).not.toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
    expect(inspect).not.toHaveTextContent(' / ')
    expect(inspect.querySelector('.garden-inspect__leftover')).toBeNull()
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
          nextStep: null,
          live: false,
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('静か')
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

  it('lists past article titles only when they were actually read', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'ブログ番',
          station: 'rest',
          traveling: false,
          summary: 'いちばん新しい記事は『春のメモ』です',
          nowText: 'いちばん新しい記事は『春のメモ』です',
          implementationLook: null,
          nextStep: null,
          live: false,
          articleTitles: [
            { title: '春のメモ', date: '2026-08-15' },
            { title: '短い下書き', date: '2026-08-01' },
            { title: 'MEMORY.md', date: '2026-08-16' },
          ],
        }}
        onClose={vi.fn()}
      />,
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('これまでの記事')
    expect(inspect).toHaveTextContent('2026-08-15 春のメモ')
    expect(inspect).toHaveTextContent('2026-08-01 短い下書き')
    expect(inspect).not.toHaveTextContent('MEMORY.md')
    expect(inspect).not.toHaveTextContent('縁側')
  })

  it('omits the article history when no title was read', () => {
    render(
      <GardenInspect
        subject={{
          kind: 'character',
          name: 'ブログ番',
          station: 'rest',
          traveling: false,
          summary: '記事の続きがある',
          nowText: '記事の続きがある',
          implementationLook: null,
          nextStep: null,
          live: false,
          articleTitles: [],
        }}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent(
      'これまでの記事',
    )
  })
})
