import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep, win32, posix } from 'node:path'
import {
  containsParentTraversal,
  isInsideResolvedRoot,
  realpathIfExists,
} from '@sikumi-local/observer-core'
import type { RegisteredRepositoryRecord } from './catalog.js'

export function normalizePathSeparators(value: string): string {
  return value.trim().replaceAll('\\', '/')
}

export function canonicalizeObservedPath(input: string): string | null {
  const trimmed = input.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > 4096 ||
    trimmed.includes('\0') ||
    containsParentTraversal(trimmed)
  ) {
    return null
  }
  const unified = normalizePathSeparators(trimmed)
  const withDrive = unified.replace(/^([A-Za-z]):/, (_, letter: string) => {
    return `${letter.toLowerCase()}:`
  })
  if (isForeignWindowsPath(withDrive)) {
    return withDrive
  }
  try {
    const real = realpathSync(resolveNativePath(trimmed))
    return normalizePathSeparators(real)
  } catch {
    try {
      return normalizePathSeparators(resolveNativePath(withDrive))
    } catch {
      return withDrive
    }
  }
}

function isForeignWindowsPath(value: string): boolean {
  return process.platform !== 'win32' && /^[a-z]:\//i.test(value)
}

export function resolveNativePath(input: string): string {
  const trimmed = input.trim()
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) {
    return win32.normalize(trimmed)
  }
  return resolve(trimmed)
}

export function pathsReferToSameLocation(left: string, right: string): boolean {
  const a = canonicalizeObservedPath(left)
  const b = canonicalizeObservedPath(right)
  if (!a || !b) {
    return false
  }
  return foldPathForCompare(a) === foldPathForCompare(b)
}

export function isCanonicalChildPath(child: string, root: string): boolean {
  const resolvedChild = canonicalizeObservedPath(child)
  const resolvedRoot = canonicalizeObservedPath(root)
  if (!resolvedChild || !resolvedRoot) {
    return false
  }
  const left = foldPathForCompare(resolvedChild)
  const right = foldPathForCompare(resolvedRoot)
  return left === right || left.startsWith(`${right}/`)
}

export function matchRegisteredRepository(
  repositoryPath: string,
  repositories: readonly RegisteredRepositoryRecord[],
): RegisteredRepositoryRecord | null {
  const canonical = canonicalizeObservedPath(repositoryPath)
  if (!canonical) {
    return null
  }
  for (const repository of repositories) {
    const candidates = [
      repository.canonicalPath,
      repository.absolutePath,
    ].filter((value) => value.length > 0)
    for (const candidate of candidates) {
      if (pathsReferToSameLocation(canonical, candidate)) {
        return repository
      }
    }
  }
  return null
}

export function resolveResourceInsideRepository(
  resourceKey: string,
  repositoryRoot: string,
): { readonly relativeKey: string; readonly absolutePath: string } | null {
  const trimmed = resourceKey.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > 4096 ||
    trimmed.includes('\0') ||
    containsParentTraversal(trimmed)
  ) {
    return null
  }
  const rootReal = realpathIfExists(repositoryRoot)
  const absolute = isAbsoluteLike(trimmed)
    ? resolveNativePath(trimmed)
    : joinUnderRoot(rootReal, trimmed)
  if (!absolute) {
    return null
  }
  try {
    if (lstatSync(absolute).isSymbolicLink()) {
      const target = realpathSync(absolute)
      if (!isInsideResolvedRoot(target, rootReal)) {
        return null
      }
    }
  } catch {
    // missing path is still acceptable if it would stay inside
  }
  const realFile = realpathIfExists(absolute)
  if (
    !isInsideResolvedRoot(realFile, rootReal) &&
    !isCanonicalChildPath(realFile, rootReal)
  ) {
    return null
  }
  const relative = toRelativeInside(realFile, rootReal)
  if (!relative || containsParentTraversal(relative)) {
    return null
  }
  return { relativeKey: relative, absolutePath: realFile }
}

function isAbsoluteLike(value: string): boolean {
  const unified = normalizePathSeparators(value)
  return (
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    unified.startsWith('/') ||
    /^[A-Za-z]:\//.test(unified)
  )
}

function joinUnderRoot(root: string, relative: string): string | null {
  const unified = normalizePathSeparators(relative).replace(/^\/+/, '')
  if (containsParentTraversal(unified) || isAbsoluteLike(unified)) {
    return null
  }
  return `${root}${sep}${unified.split('/').join(sep)}`
}

function toRelativeInside(absolute: string, root: string): string | null {
  const left = foldPathForCompare(normalizePathSeparators(absolute))
  const right = foldPathForCompare(normalizePathSeparators(root))
  if (left === right) {
    return '.'
  }
  if (!left.startsWith(`${right}/`)) {
    return null
  }
  return posix.normalize(
    normalizePathSeparators(absolute).slice(
      root.replaceAll('\\', '/').length + 1,
    ),
  )
}

function foldPathForCompare(value: string): string {
  const withoutTrailing = value.replace(/\/+$/, '')
  if (process.platform === 'win32' || /^[A-Za-z]:\//.test(withoutTrailing)) {
    return withoutTrailing.toLowerCase()
  }
  return withoutTrailing
}
