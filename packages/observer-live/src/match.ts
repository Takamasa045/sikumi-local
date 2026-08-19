import { matchLongestObservedRoot } from '@sikumi-local/observer-git'
import type { RegisteredLiveRoot } from './types.js'

export function matchRegisteredRoot(
  candidate: string | null | undefined,
  roots: readonly RegisteredLiveRoot[],
): RegisteredLiveRoot | null {
  if (!candidate) {
    return null
  }
  let best: { root: RegisteredLiveRoot; length: number } | null = null
  for (const root of roots) {
    const hit = matchLongestObservedRoot(candidate, [root.absolutePath])
    if (!hit) {
      continue
    }
    if (!best || hit.length > best.length) {
      best = { root, length: hit.length }
    }
  }
  return best?.root ?? null
}
