import { useCallback, useState } from 'react'
import {
  defaultWorldPackId,
  getWorldPack,
  resolveWorldPackId,
  type WorldPack,
  type WorldPackId,
} from './worlds'

export const GARDEN_WORLD_PACK_STORAGE_KEY = 'sikumi.garden.worldPackId'

export function readGardenWorldPackId(): WorldPackId {
  if (typeof localStorage === 'undefined') {
    return defaultWorldPackId
  }
  try {
    return resolveWorldPackId(
      localStorage.getItem(GARDEN_WORLD_PACK_STORAGE_KEY),
    )
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
  readonly setWorldPackId: (id: WorldPackId) => void
} {
  const [worldPackId, setWorldPackIdState] = useState(readGardenWorldPackId)
  const setWorldPackId = useCallback((id: WorldPackId) => {
    const next = resolveWorldPackId(id)
    setWorldPackIdState(next)
    writeGardenWorldPackId(next)
  }, [])

  return {
    worldPackId,
    world: getWorldPack(worldPackId),
    setWorldPackId,
  }
}
