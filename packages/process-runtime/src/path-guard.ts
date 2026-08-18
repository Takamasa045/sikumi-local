import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, resolve, sep } from 'node:path'
import { AppError } from '@sikumi-local/core'

const MAX_PATH_LENGTH = 4096
const MAX_DECODE_ROUNDS = 4
const SHELL_METACHARACTERS = /[|&;<>()$`\\"'\n\r*?[\]{}!#~]/
const FORBIDDEN_SHELL_NAMES = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'csh',
  'tcsh',
  'ksh',
  'fish',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
])

export function assertNoPathTraversal(input: string, label = 'path'): string {
  if (input.includes('\0')) {
    throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
  }

  let current = input
  for (let round = 0; round <= MAX_DECODE_ROUNDS; round += 1) {
    if (current.includes('\0')) {
      throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
    }
    if (containsParentTraversal(current)) {
      throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
    }
    if (!current.includes('%')) {
      return current
    }
    if (round === MAX_DECODE_ROUNDS) {
      throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(current)
    } catch {
      throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
    }
    if (decoded === current) {
      throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
    }
    current = decoded
  }

  throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
}

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

  const executableName = basename(realPath).toLowerCase()
  if (executableName.startsWith('-')) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Executable name must not start with a dash',
      400,
    )
  }
  if (FORBIDDEN_SHELL_NAMES.has(executableName)) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'Arbitrary shells are forbidden',
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
  const decoded = assertNoPathTraversal(trimmed, label)
  if (!isAbsolute(decoded)) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      `${label} must be an absolute path`,
      400,
    )
  }

  const resolved = resolve(decoded)
  if (containsParentTraversal(resolved)) {
    throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
  }
  return resolved
}

function containsParentTraversal(value: string): boolean {
  const candidates = [value, value.normalize('NFKC'), value.normalize('NFKD')]
  for (const candidate of candidates) {
    if (candidate.split(/[/\\]/).some((segment) => isParentSegment(segment))) {
      return true
    }
  }
  return false
}

function isParentSegment(segment: string): boolean {
  const normalized = segment.normalize('NFKC')
  if (normalized === '..') {
    return true
  }
  const asDots = normalized.replace(
    /[\u00B7\u2024\u2025\u2026\u2219\u22C5\uFE52\uFF0E]/g,
    '.',
  )
  return asDots === '..'
}
