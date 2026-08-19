import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('opens a small inspect when the employee or a station is clicked', async () => {
    render(
      <WorldStage
        world={getWorldPack('dog-office')}
        employeeName="サグル"
        employeeRole="調査担当"
        station="rest"
        pose="idle"
        activitySummary="まだ仕事は始まっていません"
      />,
    )

    await userEvent.click(screen.getByTestId('garden-employee'))
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('サグル')
    expect(inspect).toHaveTextContent('調査担当')
    expect(inspect).toHaveTextContent('縁側にいます')
    expect(inspect).toHaveTextContent('まだ仕事は始まっていません')

    await userEvent.click(screen.getByRole('button', { name: '資料棚' }))
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'この工房の資料を読む場所',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      '資料棚に、いまは誰もいません',
    )

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('garden-inspect')).not.toBeInTheDocument()
  })

  it('says who is at the clicked station', async () => {
    render(
      <WorldStage
        world={getWorldPack('dog-office')}
        employeeName="サグル"
        employeeRole="調査担当"
        station="archive"
        pose="reading"
        activitySummary="この工房の資料を読んでいます"
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '資料棚' }))
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'サグルが資料棚にいます',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'サグル：この工房の資料を読んでいます',
    )
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByTestId('garden-inspect')).not.toBeInTheDocument()
  })

  it('walks between stations instead of snapping', async () => {
    vi.useFakeTimers()
    const world = getWorldPack('dog-office')
    const { rerender } = render(
      <WorldStage
        world={world}
        employeeName="サグル"
        employeeRole="調査担当"
        station="rest"
        pose="idle"
      />,
    )
    const employee = screen.getByTestId('garden-employee')
    expect(employee).toHaveStyle({ left: '53%', top: '49%' })
    expect(employee).toHaveAttribute('data-traveling', 'false')

    rerender(
      <WorldStage
        world={world}
        employeeName="サグル"
        employeeRole="調査担当"
        station="archive"
        pose="reading"
      />,
    )
    expect(employee).toHaveStyle({ left: '13%', top: '22%' })
    expect(employee).toHaveAttribute('data-traveling', 'true')
    expect(employee).toHaveAttribute('data-gesture', 'walking')

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(employee).toHaveAttribute('data-traveling', 'false')
    expect(employee).toHaveAttribute('data-gesture', 'working')
    vi.useRealTimers()
  })

  it('snaps immediately when reduced motion is requested', async () => {
    stubMatchMedia(true)
    vi.useFakeTimers()
    const world = getWorldPack('dog-office')
    const { rerender } = render(
      <WorldStage
        world={world}
        employeeName="サグル"
        employeeRole="調査担当"
        station="rest"
        pose="idle"
      />,
    )

    rerender(
      <WorldStage
        world={world}
        employeeName="サグル"
        employeeRole="調査担当"
        station="workbench"
        pose="working"
      />,
    )
    const employee = screen.getByTestId('garden-employee')
    expect(employee).toHaveStyle({ left: '49%', top: '38%' })
    expect(employee).toHaveAttribute('data-traveling', 'false')
    expect(employee).toHaveAttribute('data-gesture', 'working')
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(employee).toHaveAttribute('data-traveling', 'false')
    vi.useRealTimers()
  })
})

afterEach(() => {
  vi.useRealTimers()
  stubMatchMedia(false)
})

function stubMatchMedia(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }),
  })
}
