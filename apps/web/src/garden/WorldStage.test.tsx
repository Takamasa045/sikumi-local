import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorldStage } from './WorldStage'
import { getWorldPack } from './worlds'

describe('WorldStage', () => {
  it('renders a single-frame atlas without dividing by zero', () => {
    const world = getWorldPack('dog-office')
    render(
      <WorldStage
        world={{
          ...world,
          character: {
            ...world.character,
            atlasColumns: 1,
            atlasRows: 1,
            atlasColumn: 0,
            atlasRow: 0,
          },
        }}
        employeeName="サグル"
        employeeRole="調査担当"
        station="rest"
        pose="idle"
      />,
    )

    expect(screen.getByTestId('world-stage')).toBeVisible()
    expect(screen.getByTestId('garden-where')).toHaveTextContent('いま 縁側')
  })

  it('changes visual state from growth without changing the world pack identity', () => {
    render(
      <WorldStage
        world={getWorldPack('dog-office')}
        employeeName="サグル"
        employeeRole="調査担当"
        station="rest"
        pose="idle"
        level={3}
        unlocks={['bookshelf-small']}
      />,
    )
    expect(screen.getByTestId('world-stage')).toHaveAttribute('data-level', '3')
    expect(screen.getByTestId('world-unlocks')).toHaveTextContent(
      'bookshelf-small',
    )
  })

  it('keeps archive and delivery station labels in the stage markup', () => {
    render(
      <WorldStage
        world={getWorldPack('dog-office')}
        employeeName="サグル"
        employeeRole="調査担当"
        station="archive"
        pose="reading"
      />,
    )

    expect(screen.getByText('資料棚')).toBeVisible()
    expect(screen.getByText('納品台')).toBeVisible()
    expect(screen.getByText('資料棚').closest('.garden-station')).toHaveClass(
      'is-active',
    )
    expect(
      screen.getByText('納品台').closest('.garden-station'),
    ).not.toHaveClass('is-active')
  })
})
