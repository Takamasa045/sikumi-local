import type { WorldPack } from './worlds'

export interface WorldAssetImage {
  onload: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  src: string
}

type CreateImage = () => WorldAssetImage

const assetLoads = new Map<string, Promise<void>>()
const createBrowserImage: CreateImage = () => new Image()

export function preloadWorldPackAssets(
  world: WorldPack,
  createImage: CreateImage = createBrowserImage,
): Promise<void> {
  if (typeof Image === 'undefined' && createImage === createBrowserImage) {
    return Promise.resolve()
  }

  const urls = [world.backgroundUrl, world.character.atlasUrl]
  const key = urls.join('\n')
  const cached = assetLoads.get(key)
  if (cached) {
    return cached
  }

  const loading = Promise.all(urls.map((url) => loadImage(url, createImage)))
    .then(() => undefined)
    .catch((error: unknown) => {
      assetLoads.delete(key)
      throw error
    })
  assetLoads.set(key, loading)
  return loading
}

export function clearWorldAssetCacheForTests(): void {
  assetLoads.clear()
}

function loadImage(url: string, createImage: CreateImage): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = createImage()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`庭の画像を読み込めませんでした: ${url}`))
    image.src = url
  })
}
