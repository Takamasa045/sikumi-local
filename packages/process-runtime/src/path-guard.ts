import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { AppError } from '@sikumi-local/core'

const MAX_PATH_LENGTH = 4096
const SHELL_METACHARACTERS = /[|&;<>()$`\\"'\n\r*?[\]{}!#~]/

export function assertSafeExecutable(input: string): string {
  const resolved = assertSafeAbsolutePath(input, 'executable')
  if (SHELL_METACHARACTERS.test(resolved)) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Executable path contains shell metacharacters',
      400,
    )
  }

  let realPath: string
  try {
    realPath = realpathSync(resolved)
  } catch {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Executable was not found',
      400,
    )
  }

  let stat
  try {
    stat = statSync(realPath)
  } catch {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Executable was not found',
      400,
    )
  }

  if (!stat.isFile()) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Executable must be a regular file',
      400,
    )
  }

  try {
    accessSync(realPath, constants.X_OK)
  } catch {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Executable is not executable',
      400,
    )
  }

  return realPath
}

export function assertSafeCwd(
  input: string,
  allowedRoots: readonly string[] = [],
): string {
  const resolved = assertSafeAbsolutePath(input, 'cwd')
  if (SHELL_METACHARACTERS.test(resolved)) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Working directory contains shell metacharacters',
      400,
    )
  }

  const canonical = canonicalizeExistingPath(resolved)
  if (!canonical) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Working directory was not found',
      400,
    )
  }

  let stat
  try {
    stat = statSync(canonical)
  } catch {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Working directory was not found',
      400,
    )
  }

  if (!stat.isDirectory()) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Working directory must be a directory',
      400,
    )
  }

  if (allowedRoots.length > 0 && !isInsideAnyRoot(canonical, allowedRoots)) {
    throw new AppError(
      'UNREGISTERED_CWD',
      '登録済みRepository以外では実行できません',
      400,
    )
  }

  return canonical
}

export function assertSafeArgs(args: readonly string[]): readonly string[] {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Process arguments must be a string array',
      400,
    )
  }
  if (args.some((value) => value.includes('\0'))) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Process arguments contain a NUL byte',
      400,
    )
  }
  return args
}

export function isInsideRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = canonicalizeExistingPath(candidate)
  const resolvedRoot = canonicalizeExistingPath(root)
  if (!resolvedCandidate || !resolvedRoot) {
    return false
  }
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + sep)
  )
}

function canonicalizeExistingPath(input: string): string | null {
  try {
    return realpathSync(resolve(input))
  } catch {
    return null
  }
}

function isInsideAnyRoot(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => isInsideRoot(candidate, resolve(root)))
}

function assertSafeAbsolutePath(input: string, label: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new AppError('PROCESS_SPAWN_REJECTED', `${label} is required`, 400)
  }
  if (trimmed.length > MAX_PATH_LENGTH) {
    throw new AppError('PROCESS_SPAWN_REJECTED', `${label} is too long`, 400)
  }
  if (trimmed.includes('\0')) {
    throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
  }
  if (trimmed.split(/[/\\]/).includes('..')) {
    throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
  }
  if (!isAbsolute(trimmed)) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      `${label} must be an absolute path`,
      400,
    )
  }

  const resolved = resolve(trimmed)
  if (resolved.split(/[/\\]/).includes('..')) {
    throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
  }
  return resolved
}
