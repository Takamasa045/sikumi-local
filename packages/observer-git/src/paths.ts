import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import {
  containsParentTraversal,
  isContainedPath,
  isSafeRelativePath,
  looksWindowsAbsolutePath,
  toRepoRelativePath,
} from '@sikumi-local/observer-core'
import { isInsideRoot } from '@sikumi-local/process-runtime'

export function sanitizeRepoPath(
  input: string,
  repositoryRoot: string,
): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed.includes('\0')) {
    return null
  }
  if (containsParentTraversal(trimmed)) {
    return null
  }

  if (!isAbsolute(trimmed) && !looksWindowsAbsolutePath(trimmed)) {
    return isSafeRelativePath(trimmed) ? toRepoRelativePath(trimmed) : null
  }

  if (looksWindowsAbsolutePath(trimmed) || looksWindowsAbsolutePath(repositoryRoot)) {
    if (!isContainedPath(trimmed, repositoryRoot)) {
      return null
    }
    const relative = toRepoRelativePath(trimmed, repositoryRoot)
    return isSafeRelativePath(relative) || relative === '.' ? relative : null
  }

  let realFile: string
  try {
    realFile = realpathSync(trimmed)
  } catch {
    const relative = toRepoRelativePath(trimmed, repositoryRoot)
    return isSafeRelativePath(relative) || relative === '.' ? relative : null
  }

  if (!isInsideRoot(realFile, repositoryRoot)) {
    return null
  }
  try {
    if (lstatSync(trimmed).isSymbolicLink()) {
      const target = realpathSync(trimmed)
      if (!isInsideRoot(target, repositoryRoot)) {
        return null
      }
    }
  } catch {
    // missing path is still usable as a relative name if inside
  }
  return toRepoRelativePath(realFile, realpathSync(repositoryRoot))
}

export function resolveExistingRoot(path: string): string | null {
  try {
    return realpathSync(resolve(path))
  } catch {
    return null
  }
}

export function joinInside(root: string, relative: string): string {
  return `${root}${sep}${relative.split('/').join(sep)}`
}

export function matchLongestObservedRoot(
  candidate: string | null | undefined,
  roots: readonly string[],
): string | null {
  if (!candidate) {
    return null
  }
  const resolvedCandidate = resolvePathForMatch(candidate)
  if (!resolvedCandidate) {
    return null
  }
  let best: string | null = null
  for (const root of roots) {
    const resolvedRoot = resolvePathForMatch(root)
    if (!resolvedRoot || !isSameOrChildPath(resolvedCandidate, resolvedRoot)) {
      continue
    }
    if (!best || resolvedRoot.length > best.length) {
      best = resolvedRoot
    }
  }
  return best
}

function resolvePathForMatch(input: string): string | null {
  const trimmed = input.trim()
  if (
    trimmed.length === 0 ||
    trimmed.includes('\0') ||
    containsParentTraversal(trimmed)
  ) {
    return null
  }
  if (looksWindowsAbsolutePath(trimmed)) {
    return trimmed
  }
  try {
    return realpathSync(resolve(trimmed))
  } catch {
    const resolved = resolve(trimmed)
    if (looksWindowsAbsolutePath(input) && !looksWindowsAbsolutePath(resolved)) {
      return trimmed
    }
    return resolved
  }
}

function isSameOrChildPath(candidate: string, root: string): boolean {
  return isContainedPath(candidate, root)
}
