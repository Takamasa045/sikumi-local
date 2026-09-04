import { useCallback, useEffect, useRef, useState } from 'react'
import { listGardenWorlds } from '../api/packs'
import { preloadWorldPackAssets } from './worldAssetLoader'
import {
  defaultWorldPackId,
  findWorldPack,
  mergeGardenWorldPacks,
  type WorldPack,
  type WorldPackId,
  worldPacks,
} from './worlds'

export const GARDEN_WORLD_PACK_STORAGE_KEY = 'sikumi.garden.worldPackId'

export function readGardenWorldPackId(): WorldPackId {
  if (typeof localStorage === 'undefined') {
    return defaultWorldPackId
  }
  try {
    const stored = localStorage.getItem(GARDEN_WORLD_PACK_STORAGE_KEY)
    return stored && stored.trim().length > 0 ? stored : defaultWorldPackId
  } catch {
    return defaultWorldPackId
  }
}

function writeGardenWorldPackId(id: WorldPackId): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(GARDEN_WORLD_PACK_STORAGE_KEY, id)
  } catch {
    // Private mode and quota errors should not lock the garden look.
  }
}

export function useGardenWorldPack(): {
  readonly worldPackId: WorldPackId
  readonly world: WorldPack
  readonly packs: readonly WorldPack[]
  readonly setWorldPackId: (id: WorldPackId) => void
} {
  const [worldPackId, setWorldPackIdState] = useState(readGardenWorldPackId)
  const [packs, setPacks] = useState<readonly WorldPack[]>(worldPacks)
  const initialWorldPackId = useRef(worldPackId)

  useEffect(() => {
    let cancelled = false
    void listGardenWorlds()
      .then(async (installedWorlds) => {
        const merged = mergeGardenWorldPacks(installedWorlds)
        const selected = merged.find(
          (pack) => pack.id === initialWorldPackId.current,
        )
        const isInstalled =
          selected && !worldPacks.some((pack) => pack.id === selected.id)
        if (selected && isInstalled) {
          await preloadWorldPackAssets(selected)
        }
        if (!cancelled) {
          setPacks(merged)
        }
      })
      .catch(() => {
        // Built-in looks stay available when the catalog cannot be read.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const world = findWorldPack(worldPackId, packs)
  const setWorldPackId = useCallback(
    (id: WorldPackId) => {
      const known = packs.some((pack) => pack.id === id)
        ? id
        : worldPacks.some((pack) => pack.id === id)
          ? id
          : defaultWorldPackId
      setWorldPackIdState(known)
      writeGardenWorldPackId(known)
    },
    [packs],
  )

  return {
    worldPackId: world.id,
    world,
    packs,
    setWorldPackId,
  }
}
