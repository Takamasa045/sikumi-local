import { isAbsolute, posix, win32 } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { OBSERVER_MAX_PATH_CHARS } from './limits.js'

const DOT_LOOKALIKES = /[\u00B7\u2024\u2025\u2026\u2219\u22C5\uFE52\uFF0E]/g

export function looksWindowsAbsolutePath(value: string): boolean {
  const trimmed = value.trim()
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return true
  }
  const unified = trimmed.replaceAll('\\', '/')
  return unified.startsWith('//') && unified.length > 2 && unified[2] !== '/'
}

export function normalizeComparablePath(input: string): string {
  const trimmed = input.trim()
  const windows = looksWindowsAbsolutePath(trimmed) || trimmed.includes('\\')
  let unified = trimmed.replaceAll('\\', '/')
  if (windows) {
    unified = unified.toLowerCase()
  }
  if (unified.length > 1) {
    unified = unified.replace(/\/+$/, '')
  }
  return unified
}

export function isContainedPath(candidate: string, root: string): boolean {
  const left = normalizeComparablePath(candidate)
  const right = normalizeComparablePath(root)
  if (left.length === 0 || right.length === 0) {
    return false
  }
  if (left === right) {
    return true
  }
  return left.startsWith(`${right}/`)
}

export function normalizeObserverPath(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new AppError('PATH_TRAVERSAL', 'Path is empty', 400)
  }
  if (trimmed.length > OBSERVER_MAX_PATH_CHARS || trimmed.includes('\0')) {
    throw new AppError('PATH_TRAVERSAL', 'Path is not safe', 400)
  }
  if (containsParentTraversal(trimmed)) {
    throw new AppError('PATH_TRAVERSAL', 'Path is not safe', 400)
  }

  const unified = trimmed.replaceAll('\\', '/')
  const withoutPrefix = unified.replace(/^[A-Za-z]:/, '')
  const posixPath = posix.normalize(withoutPrefix)
  if (containsParentTraversal(posixPath) || posixPath.startsWith('..')) {
    throw new AppError('PATH_TRAVERSAL', 'Path is not safe', 400)
  }
  return posixPath.replace(/^\.\//, '')
}

export function toRepoRelativePath(
  input: string,
  repositoryRoot?: string | null,
): string {
  const normalized = normalizeObserverPath(input)
  if (!repositoryRoot) {
    return stripLeadingSlash(normalized)
  }
  if (looksWindowsAbsolutePath(input) || looksWindowsAbsolutePath(repositoryRoot)) {
    if (!isContainedPath(input, repositoryRoot)) {
      return isAbsoluteLike(normalized) ? normalized : stripLeadingSlash(normalized)
    }
    const relative = relativeComparablePath(input, repositoryRoot)
    return relative.length === 0 ? '.' : relative
  }
  if (!isAbsoluteLike(normalized)) {
    return stripLeadingSlash(normalized)
  }

  const root = normalizeObserverPath(repositoryRoot).replace(/\/$/, '')
  const candidate = normalized
  if (candidate === root) {
    return '.'
  }
  if (candidate.startsWith(`${root}/`)) {
    return candidate.slice(root.length + 1)
  }
  return candidate
}

function relativeComparablePath(input: string, root: string): string {
  const left = normalizeComparablePath(input)
  const right = normalizeComparablePath(root)
  if (left === right) {
    return ''
  }
  return left.startsWith(`${right}/`) ? left.slice(right.length + 1) : left
}

export function containsParentTraversal(value: string): boolean {
  const forms = [value, value.normalize('NFKC'), value.normalize('NFKD')]
  return forms.some((form) =>
    form.split(/[/\\]/).some((segment) => isParentSegment(segment)),
  )
}

export function isSafeRelativePath(value: string): boolean {
  try {
    const normalized = normalizeObserverPath(value)
    return !isAbsoluteLike(normalized) && !containsParentTraversal(normalized)
  } catch {
    return false
  }
}

function isParentSegment(segment: string): boolean {
  const normalized = segment.normalize('NFKC')
  if (normalized === '..') {
    return true
  }
  return normalized.replace(DOT_LOOKALIKES, '.') === '..'
}

function isAbsoluteLike(value: string): boolean {
  return (
    isAbsolute(value) ||
    isAbsolute(win32.normalize(value)) ||
    looksWindowsAbsolutePath(value) ||
    value.startsWith('/')
  )
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '')
}
