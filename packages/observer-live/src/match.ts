import { normalizeComparablePath } from '@sikumi-local/observer-core'
import { matchLongestObservedRoot } from '@sikumi-local/observer-git'
import { sameRepoIdentity } from './identity.js'
import type { RegisteredLiveRoot } from './types.js'

export type RegisteredPlaceKind = 'contained' | 'alias'

export type RegisteredPlaceMatch = {
  readonly root: RegisteredLiveRoot
  readonly kind: RegisteredPlaceKind
}

const UNBINDABLE_CWDS = new Set(['/', '', '.'])

export function isBindableCwd(cwd: string | null | undefined): boolean {
  if (!cwd) {
    return false
  }
  const normalized = normalizeComparablePath(cwd)
  if (UNBINDABLE_CWDS.has(normalized) || /^[a-z]:$/i.test(normalized)) {
    return false
  }
  return true
}

export function matchRegisteredRoot(
  candidate: string | null | undefined,
  roots: readonly RegisteredLiveRoot[],
): RegisteredLiveRoot | null {
  return matchRegisteredPlace(candidate, roots)?.root ?? null
}

export function matchRegisteredPlace(
  candidate: string | null | undefined,
  roots: readonly RegisteredLiveRoot[],
): RegisteredPlaceMatch | null {
  if (!isBindableCwd(candidate)) {
    return null
  }
  let bestContained: { root: RegisteredLiveRoot; length: number } | null = null
  for (const root of roots) {
    const hit = matchLongestObservedRoot(candidate, [root.absolutePath])
    if (!hit) {
      continue
    }
    if (!bestContained || hit.length > bestContained.length) {
      bestContained = { root, length: hit.length }
    }
  }
  if (bestContained) {
    return { root: bestContained.root, kind: 'contained' }
  }

  let bestAlias: { root: RegisteredLiveRoot; length: number } | null = null
  for (const root of roots) {
    const twinRoot = leafTwinFolder(candidate, root.absolutePath)
    if (!twinRoot) {
      continue
    }
    if (!sameRepoIdentity(twinRoot, root.absolutePath)) {
      continue
    }
    const length = normalizeComparablePath(root.absolutePath).length
    if (!bestAlias || length > bestAlias.length) {
      bestAlias = { root, length }
    }
  }
  return bestAlias ? { root: bestAlias.root, kind: 'alias' } : null
}

export function isSameLeafAlias(
  candidate: string | null | undefined,
  registered: string,
): boolean {
  return leafTwinFolder(candidate, registered) !== null
}

export function leafTwinFolder(
  candidate: string | null | undefined,
  registered: string,
): string | null {
  if (!candidate || !isBindableCwd(candidate)) {
    return null
  }
  const registeredParts = splitComparablePath(registered)
  const leaf = registeredParts.at(-1)
  if (!leaf || registeredParts.length < 2) {
    return null
  }
  const candidateParts = splitComparablePath(candidate)
  for (let end = candidateParts.length; end >= 1; end -= 1) {
    const ancestor = candidateParts.slice(0, end)
    if (ancestor.at(-1) !== leaf) {
      continue
    }
    if (isOneLevelNestedTwin(ancestor, registeredParts)) {
      const normalized = normalizeComparablePath(candidate)
      return `${normalized.startsWith('/') ? '/' : ''}${ancestor.join('/')}`
    }
  }
  return null
}

function isOneLevelNestedTwin(
  candidateParts: readonly string[],
  registeredParts: readonly string[],
): boolean {
  if (candidateParts.at(-1) !== registeredParts.at(-1)) {
    return false
  }
  const candidateParent = candidateParts.slice(0, -1)
  const registeredParent = registeredParts.slice(0, -1)
  if (candidateParent.length === registeredParent.length + 1) {
    return startsWithParts(candidateParent, registeredParent)
  }
  if (registeredParent.length === candidateParent.length + 1) {
    return startsWithParts(registeredParent, candidateParent)
  }
  return false
}

export function uniqueMatchedPlace(
  candidates: readonly (string | null | undefined)[],
  roots: readonly RegisteredLiveRoot[],
): RegisteredPlaceMatch | null {
  const matches: RegisteredPlaceMatch[] = []
  for (const candidate of candidates) {
    const matched = matchRegisteredPlace(candidate, roots)
    if (!matched) {
      continue
    }
    if (
      !matches.some(
        (item) => item.root.repositoryId === matched.root.repositoryId,
      )
    ) {
      matches.push(matched)
    }
  }
  return matches.length === 1 ? matches[0]! : null
}

function splitComparablePath(path: string): string[] {
  return normalizeComparablePath(path).split('/').filter(Boolean)
}

function startsWithParts(
  longer: readonly string[],
  prefix: readonly string[],
): boolean {
  if (prefix.length === 0 || longer.length < prefix.length) {
    return false
  }
  return prefix.every((part, index) => longer[index] === part)
}
