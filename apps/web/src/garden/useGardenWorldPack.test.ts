import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GARDEN_WORLD_PACK_STORAGE_KEY,
  readGardenWorldPackId,
  useGardenWorldPack,
} from './useGardenWorldPack'
import { preloadWorldPackAssets } from './worldAssetLoader'

vi.mock('./worldAssetLoader', () => ({
  preloadWorldPackAssets: vi.fn(),
}))

const preloadMock = vi.mocked(preloadWorldPackAssets)

beforeEach(() => {
  preloadMock.mockReset()
  preloadMock.mockResolvedValue()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/worlds')) {
        return new Response(JSON.stringify({ worlds: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: 'not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
})

afterEach(() => {
  localStorage.removeItem(GARDEN_WORLD_PACK_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('useGardenWorldPack', () => {
  it('defaults to the satoyama atelier when nothing is stored', () => {
    expect(readGardenWorldPackId()).toBe('dog-office')

    const { result } = renderHook(() => useGardenWorldPack())
    expect(result.current.worldPackId).toBe('dog-office')
    expect(result.current.world.id).toBe('dog-office')
    expect(result.current.world.lookName).toBe('里山')
    expect(result.current.packs.map((pack) => pack.lookName)).toEqual([
      '里山',
      '工房',
    ])
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
    expect(readGardenWorldPackId()).toBe('office-sim')
    const { result } = renderHook(() => useGardenWorldPack())
    expect(result.current.world.id).toBe('dog-office')
  })

  it('makes an installed pack selectable and keeps builtin assets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/worlds')) {
          return new Response(
            JSON.stringify({
              worlds: [
                {
                  id: 'night-garden',
                  name: '夜の庭',
                  lookName: '夜',
                  description: 'Zipで足した庭',
                  backgroundUrl:
                    '/api/worlds/night-garden/assets/background.png',
                  atlasUrl: '/api/worlds/night-garden/assets/characters.png',
                  atlasColumns: 3,
                  atlasRows: 4,
                },
              ],
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          )
        }
        return new Response('{}', { status: 404 })
      }),
    )

    localStorage.setItem(GARDEN_WORLD_PACK_STORAGE_KEY, 'night-garden')
    const { result } = renderHook(() => useGardenWorldPack())
    await waitFor(() => {
      expect(result.current.packs.map((pack) => pack.id)).toEqual([
        'dog-office',
        'craft-workshop',
        'night-garden',
      ])
    })
    expect(result.current.world.id).toBe('night-garden')
    expect(result.current.world.backgroundUrl).toBe(
      '/api/worlds/night-garden/assets/background.png',
    )
    expect(result.current.world.character.atlasUrl).toBe(
      '/api/worlds/night-garden/assets/characters.png',
    )
    expect(
      result.current.packs.find((pack) => pack.id === 'dog-office')
        ?.backgroundUrl,
    ).not.toContain('/api/worlds/')
  })

  it('keeps the current background until a stored installed look is ready', async () => {
    let finishPreload: (() => void) | undefined
    preloadMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPreload = resolve
        }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            worlds: [
              {
                id: 'night-garden',
                name: '夜の庭',
                lookName: '夜',
                description: '',
                backgroundUrl:
                  '/api/worlds/night-garden/assets/background.png?v=1.0.0',
                atlasUrl:
                  '/api/worlds/night-garden/assets/characters.png?v=1.0.0',
                atlasColumns: 3,
                atlasRows: 4,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )
    localStorage.setItem(GARDEN_WORLD_PACK_STORAGE_KEY, 'night-garden')

    const { result } = renderHook(() => useGardenWorldPack())
    await waitFor(() => expect(preloadMock).toHaveBeenCalledTimes(1))
    expect(result.current.world.id).toBe('dog-office')

    finishPreload?.()
    await waitFor(() => expect(result.current.world.id).toBe('night-garden'))
  })
})
