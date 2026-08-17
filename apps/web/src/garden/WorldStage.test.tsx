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
      />,
    )

    expect(screen.getByTestId('world-stage')).toBeVisible()
  })
})
