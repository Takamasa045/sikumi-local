import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearWorldAssetCacheForTests,
  preloadWorldPackAssets,
  type WorldAssetImage,
} from './worldAssetLoader'
import { getWorldPack, type WorldPack } from './worlds'

beforeEach(() => {
  clearWorldAssetCacheForTests()
})

describe('preloadWorldPackAssets', () => {
  it('loads the background and atlas once per versioned URL pair', async () => {
    const requested: string[] = []
    const createImage = imageFactory(requested)
    const world = installedWorld('1.0.0')

    await preloadWorldPackAssets(world, createImage)
    await preloadWorldPackAssets(world, createImage)

    expect(requested).toEqual([world.backgroundUrl, world.character.atlasUrl])
  })

  it('loads upgraded asset URLs instead of reusing the previous cache entry', async () => {
    const requested: string[] = []
    const createImage = imageFactory(requested)

    await preloadWorldPackAssets(installedWorld('1.0.0'), createImage)
    await preloadWorldPackAssets(installedWorld('1.0.1'), createImage)

    expect(requested).toHaveLength(4)
    expect(requested[2]).toContain('v=1.0.1')
    expect(requested[3]).toContain('v=1.0.1')
  })
})

function installedWorld(version: string): WorldPack {
  const fallback = getWorldPack('dog-office')
  return {
    ...fallback,
    id: 'night-garden',
    backgroundUrl: `/api/worlds/night-garden/assets/background.webp?v=${version}`,
    character: {
      ...fallback.character,
      atlasUrl: `/api/worlds/night-garden/assets/characters.webp?v=${version}`,
    },
  }
}

function imageFactory(requested: string[]) {
  return (): WorldAssetImage => {
    let onload: ((event: Event) => void) | null = null
    return {
      get onload() {
        return onload
      },
      set onload(value) {
        onload = value
      },
      onerror: null,
      set src(value: string) {
        requested.push(value)
        queueMicrotask(() => onload?.(new Event('load')))
      },
    }
  }
}
