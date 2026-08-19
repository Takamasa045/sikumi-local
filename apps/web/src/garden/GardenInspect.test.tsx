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
