import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GARDEN_WORLD_PACK_STORAGE_KEY,
  readGardenWorldPackId,
  useGardenWorldPack,
} from './useGardenWorldPack'

afterEach(() => {
  localStorage.removeItem(GARDEN_WORLD_PACK_STORAGE_KEY)
})

describe('useGardenWorldPack', () => {
  it('defaults to the satoyama atelier when nothing is stored', () => {
    expect(readGardenWorldPackId()).toBe('dog-office')

    const { result } = renderHook(() => useGardenWorldPack())
    expect(result.current.worldPackId).toBe('dog-office')
    expect(result.current.world.id).toBe('dog-office')
    expect(result.current.world.lookName).toBe('里山')
  })

  it('keeps a stored workshop look after remount', () => {
    const first = renderHook(() => useGardenWorldPack())
    act(() => {
      first.result.current.setWorldPackId('craft-workshop')
    })
    expect(localStorage.getItem(GARDEN_WORLD_PACK_STORAGE_KEY)).toBe(
      'craft-workshop',
    )
    first.unmount()

    const second = renderHook(() => useGardenWorldPack())
    expect(second.result.current.worldPackId).toBe('craft-workshop')
    expect(second.result.current.world.id).toBe('craft-workshop')
    expect(second.result.current.world.lookName).toBe('工房')
  })

  it('falls back to the satoyama atelier for an unknown stored id', () => {
    localStorage.setItem(GARDEN_WORLD_PACK_STORAGE_KEY, 'office-sim')
    expect(readGardenWorldPackId()).toBe('dog-office')
  })
})
