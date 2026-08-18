import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { MAX_PACK_PATH_LENGTH } from './limits.js'

export function assertRelativePackPath(input: string, label: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw packError(`${label} is required`)
  }
  if (trimmed.length > MAX_PACK_PATH_LENGTH) {
    throw packError(`${label} is too long`)
  }
  if (trimmed.includes('\0')) {
    throw packError(`${label} is not safe`)
  }
  if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw packError(`${label} must be a relative path`)
  }
  const segments = trimmed.split(/[/\\]/)
  if (segments.includes('..') || segments.includes('')) {
    throw packError(`${label} must not contain '..' or empty segments`)
  }
  return segments.join('/')
}

export function resolveContainedPath(
  root: string,
  relativePath: string,
  label: string,
): string {
  const safeRelative = assertRelativePackPath(relativePath, label)
  const candidate = resolve(join(root, safeRelative))
  if (!isInsideResolvedRoot(candidate, root)) {
    throw packError(`${label} escapes the pack root`)
  }
  return candidate
}

export function assertRealPathInside(
  candidate: string,
  root: string,
  label: string,
): string {
  let realCandidate: string
  let realRoot: string
  try {
    realCandidate = realpathSync(candidate)
    realRoot = realpathSync(root)
  } catch {
    throw packError(`${label} could not be resolved`)
  }
  if (!isInsideResolvedRoot(realCandidate, realRoot)) {
    throw packError(`${label} escapes the pack root`)
  }
  if (isSymlink(candidate) && !isInsideResolvedRoot(realCandidate, realRoot)) {
    throw packError(`${label} symlink is not allowed`)
  }
  return realCandidate
}

export function isInsideResolvedRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate)
  const resolvedRoot = resolve(root)
  const relativePath = relative(resolvedRoot, resolvedCandidate)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

export function packError(message: string): AppError {
  return new AppError('EMPLOYEE_PACK_INVALID', message, 400)
}

export function toPosixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join('/')
}
