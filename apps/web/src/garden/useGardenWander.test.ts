import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGardenWander } from './useGardenWander'

afterEach(() => {
  vi.useRealTimers()
})

describe('useGardenWander', () => {
  it('stays at home when motion is reduced or wandering is off', () => {
    const { result: reduced } = renderHook(() =>
      useGardenWander({ x: 40, y: 50 }, true, true),
    )
    expect(reduced.current).toEqual({ x: 40, y: 50 })

    const { result: idle } = renderHook(() =>
      useGardenWander({ x: 40, y: 50 }, false, false),
    )
    expect(idle.current).toEqual({ x: 40, y: 50 })
  })

  it('takes a small step away from home while wandering', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useGardenWander({ x: 40, y: 50 }, true, false),
    )

    expect(result.current).toEqual({ x: 40, y: 50 })
    act(() => {
      vi.advanceTimersByTime(2_600)
    })
    expect(result.current).not.toEqual({ x: 40, y: 50 })
    expect(Math.abs(result.current.x - 40)).toBeLessThan(6)
    expect(Math.abs(result.current.y - 50)).toBeLessThan(6)
  })
})
