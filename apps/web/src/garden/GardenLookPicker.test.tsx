import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GardenLookPicker } from './GardenLookPicker'
import { preloadWorldPackAssets } from './worldAssetLoader'
import { getWorldPack, type WorldPack } from './worlds'

vi.mock('./worldAssetLoader', () => ({
  preloadWorldPackAssets: vi.fn(),
}))

const preloadMock = vi.mocked(preloadWorldPackAssets)

beforeEach(() => {
  preloadMock.mockReset()
  preloadMock.mockResolvedValue()
})

describe('GardenLookPicker', () => {
  it('keeps only the current look in the compact closed control', async () => {
    renderPicker()

    const toggle = screen.getByRole('button', { name: '庭の見た目：里山' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: '庭を選ぶ' })).toBeNull()

    await userEvent.click(toggle)

    const menu = screen.getByRole('group', { name: '庭を選ぶ' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getByRole('button', { name: '里山' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(menu).getByRole('button', { name: '工房' })).toBeVisible()
    expect(within(menu).getByRole('button', { name: '夜' })).toBeVisible()
  })

  it('waits for both images before switching and then closes the menu', async () => {
    let finishPreload: (() => void) | undefined
    preloadMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPreload = resolve
        }),
    )
    renderPicker()

    await userEvent.click(
      screen.getByRole('button', { name: '庭の見た目：里山' }),
    )
    await userEvent.click(screen.getByRole('button', { name: '夜' }))

    expect(screen.getByRole('button', { name: '夜を読み込み中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '庭の見た目：里山' })).toBeVisible()

    finishPreload?.()
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '庭の見た目：夜' }),
      ).toHaveAttribute('aria-expanded', 'false')
    })
    expect(screen.queryByRole('group', { name: '庭を選ぶ' })).toBeNull()
  })

  it('closes on Escape and returns focus to the toggle', async () => {
    renderPicker()
    const toggle = screen.getByRole('button', { name: '庭の見た目：里山' })
    await userEvent.click(toggle)

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('group', { name: '庭を選ぶ' })).toBeNull()
    expect(toggle).toHaveFocus()
  })
})

function renderPicker() {
  const builtin = [getWorldPack('dog-office'), getWorldPack('craft-workshop')]
  const night: WorldPack = {
    ...builtin[0]!,
    id: 'night-garden',
    name: '夜の庭',
    shortName: '夜',
    lookName: '夜',
    backgroundUrl: '/api/worlds/night-garden/assets/background.webp?v=1.0.0',
    character: {
      ...builtin[0]!.character,
      atlasUrl: '/api/worlds/night-garden/assets/characters.webp?v=1.0.0',
    },
  }

  function Harness() {
    const [selected, setSelected] = useState<WorldPack>(builtin[0]!)
    return (
      <GardenLookPicker
        packs={[...builtin, night]}
        world={selected}
        onSelect={(id) => {
          setSelected([builtin[0]!, builtin[1]!, night].find((item) => item.id === id)!)
        }}
      />
    )
  }

  return render(<Harness />)
}
