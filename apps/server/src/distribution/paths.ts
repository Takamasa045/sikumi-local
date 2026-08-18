import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '@sikumi-local/core'
import {
  DATA_LAYOUT_VERSION,
  DATA_SUBDIRECTORIES,
  databaseFilePath,
  layoutMarkerPath,
  resolveDataDirectory,
} from '../storage/data-directory.js'

const MAX_PATH_LENGTH = 4096
const SECURE_DIRECTORY_MODE = 0o700

const PROTECTED_BASENAMES = new Set([
  '',
  '/',
  '.',
  '..',
  'etc',
  'usr',
  'bin',
  'sbin',
  'System',
  'Library',
  'Applications',
  'Windows',
  'Program Files',
  'Program Files (x86)',
])

export interface DataDirectoryInspection {
  readonly requested: string
  readonly resolved: string
  readonly exists: boolean
  readonly isDirectory: boolean
  readonly isSymlink: boolean
  readonly realPath: string | null
  readonly hasLayoutMarker: boolean
  readonly hasDatabase: boolean
  readonly recognized: boolean
}

export function resolveRequestedDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const requested = resolveDataDirectory(env)
  return assertSafeDataDirectoryInput(requested)
}

export function assertSafeDataDirectoryInput(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      'Data directory is required',
      400,
    )
  }
  if (trimmed.length > MAX_PATH_LENGTH) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      'Data directory is too long',
      400,
    )
  }
  if (trimmed.includes('\0')) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      'Data directory is not safe',
      400,
    )
  }
  if (trimmed.split(/[/\\]/).includes('..')) {
    throw new AppError(
      'PATH_TRAVERSAL',
      'Data directory must not contain parent segments',
      400,
    )
  }
  if (!isAbsolute(trimmed)) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      'Data directory must be an absolute path',
      400,
    )
  }
  const resolved = resolve(trimmed)
  if (resolved.split(/[/\\]/).includes('..')) {
    throw new AppError(
      'PATH_TRAVERSAL',
      'Data directory must not contain parent segments',
      400,
    )
  }
  assertNotProtectedSystemPath(resolved)
  assertNotRepositoryPath(resolved)
  return resolved
}

export function assertNoSymlinkAncestors(target: string): void {
  const resolved = resolve(target)
  const { root } = parse(resolved)
  const parts = resolved
    .slice(root.length)
    .split(/[/\\]/)
    .filter((part) => part.length > 0)
  if (root && existsSync(root) && lstatSync(root).isSymbolicLink()) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      'Refusing to follow a symlink ancestor',
      400,
    )
  }
  let current = root
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    if (!existsSync(current)) {
      return
    }
    if (lstatSync(current).isSymbolicLink()) {
      throw new AppError(
        'DATA_DIRECTORY_UNSAFE',
        'Refusing to follow a symlink ancestor',
        400,
      )
    }
  }
}

export function assertNoSymlinkAlongPath(target: string): void {
  assertNoSymlinkAncestors(target)
  const resolved = resolve(target)
  try {
    if (lstatSync(resolved).isSymbolicLink()) {
      throw new AppError(
        'DATA_DIRECTORY_UNSAFE',
        'Refusing to follow a symlink in the path',
        400,
      )
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
  }
}

export function inspectDataDirectory(input: string): DataDirectoryInspection {
  const requested = assertSafeDataDirectoryInput(input)
  assertNoSymlinkAncestors(requested)
  const exists = existsSync(requested)
  let isSymlink = false
  let isDirectory = false
  let realPath: string | null = null
  if (exists) {
    const stat = lstatSync(requested)
    isSymlink = stat.isSymbolicLink()
    isDirectory = stat.isDirectory()
    try {
      realPath = realpathSync(requested)
    } catch {
      realPath = null
    }
  }
  const probeRoot = realPath ?? requested
  const hasLayoutMarker = existsSync(layoutMarkerPath(probeRoot))
  const hasDatabase = existsSync(databaseFilePath(probeRoot))
  return {
    requested,
    resolved: requested,
    exists,
    isDirectory,
    isSymlink,
    realPath,
    hasLayoutMarker,
    hasDatabase,
    recognized: hasLayoutMarker || hasDatabase,
  }
}

export function assertResettableDataDirectory(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const expected = resolveRequestedDataDirectory(env)
  const inspection = inspectDataDirectory(input)
  if (inspection.resolved !== expected) {
    throw new AppError(
      'RESET_REFUSED',
      'Reset target is not the configured data directory',
      400,
    )
  }
  if (inspection.isSymlink) {
    throw new AppError(
      'RESET_REFUSED',
      'Refusing to reset a data directory that is a symlink',
      400,
    )
  }
  if (!inspection.exists || !inspection.isDirectory) {
    throw new AppError('RESET_REFUSED', 'Data directory does not exist', 400)
  }
  if (inspection.realPath !== inspection.resolved) {
    throw new AppError(
      'RESET_REFUSED',
      'Data directory resolves outside the configured path',
      400,
    )
  }
  if (!inspection.recognized) {
    throw new AppError(
      'RESET_REFUSED',
      'Directory is not a Shikumi Local data directory',
      400,
    )
  }
  assertPathIsNotRepositoryRoot(inspection.resolved)
  assertNotProtectedSystemPath(inspection.resolved)
  return inspection.resolved
}

export function ensureDataLayout(dataDirectory: string): string {
  const resolved = assertSafeDataDirectoryInput(dataDirectory)
  assertNoSymlinkAlongPath(resolved)
  mkdirSecureRecursive(resolved)
  for (const name of DATA_SUBDIRECTORIES) {
    mkdirSecureRecursive(join(resolved, name))
  }
  const marker = layoutMarkerPath(resolved)
  if (!existsSync(marker)) {
    writeFileSync(
      marker,
      `${JSON.stringify(
        {
          format: 'shikumi-local-data',
          schemaVersion: DATA_LAYOUT_VERSION,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  }
  chmodIfPresent(resolved, SECURE_DIRECTORY_MODE)
  return resolved
}

export function isInsideDirectory(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate)
  const resolvedRoot = resolve(root)
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + sep)
  )
}

export function assertPathInside(
  candidate: string,
  root: string,
  label: string,
): string {
  const resolvedCandidate = assertSafeDataDirectoryInput(candidate)
  const resolvedRoot = assertSafeDataDirectoryInput(root)
  if (!isInsideDirectory(resolvedCandidate, resolvedRoot)) {
    throw new AppError(
      'PATH_TRAVERSAL',
      `${label} escapes the allowed directory`,
      400,
    )
  }
  if (existsSync(resolvedCandidate)) {
    let real: string
    try {
      real = realpathSync(resolvedCandidate)
    } catch {
      throw new AppError('PATH_TRAVERSAL', `${label} is not safe`, 400)
    }
    if (!isInsideDirectory(real, resolvedRoot)) {
      throw new AppError(
        'PATH_TRAVERSAL',
        `${label} resolves outside the allowed directory`,
        400,
      )
    }
    return real
  }
  return resolvedCandidate
}

export function findRepositoryRoot(
  start: string = fileURLToPath(new URL('.', import.meta.url)),
): string | null {
  let current = resolve(start)
  for (let index = 0; index < 12; index += 1) {
    if (
      existsSync(join(current, 'pnpm-workspace.yaml')) &&
      existsSync(join(current, 'package.json'))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return null
}

function mkdirSecureRecursive(target: string): void {
  assertNoSymlinkAlongPath(target)
  const resolved = resolve(target)
  const { root } = parse(resolved)
  const parts = resolved
    .slice(root.length)
    .split(/[/\\]/)
    .filter((part) => part.length > 0)
  let current = root
  for (const part of parts) {
    current = join(current, part)
    if (existsSync(current)) {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) {
        throw new AppError(
          'DATA_DIRECTORY_UNSAFE',
          'Refusing to follow a symlink in the data directory',
          400,
        )
      }
      if (!stat.isDirectory()) {
        throw new AppError(
          'DATA_DIRECTORY_UNSAFE',
          'Refusing to replace a non-directory in the data path',
          400,
        )
      }
      continue
    }
    mkdirSync(current, { mode: SECURE_DIRECTORY_MODE })
  }
  chmodIfPresent(resolved, SECURE_DIRECTORY_MODE)
}

function chmodIfPresent(path: string, mode: number): void {
  if (!existsSync(path)) {
    return
  }
  try {
    chmodSync(path, mode)
  } catch {
    // Directory may be owned by another user in read-only diagnostics.
  }
}

function assertNotProtectedSystemPath(resolved: string): void {
  const home = resolve(homedir())
  const temp = resolve(tmpdir())
  const forbidden = new Set([
    resolve('/'),
    home,
    temp,
    resolve('/etc'),
    resolve('/usr'),
    resolve('/var'),
    resolve('/bin'),
    resolve('/sbin'),
    resolve('/System'),
    resolve('/Library'),
    resolve('/Applications'),
  ])
  if (forbidden.has(resolved)) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      'Refusing to use a protected system directory as the data directory',
      400,
    )
  }
  const { root, base } = parse(resolved)
  if (resolved === root || PROTECTED_BASENAMES.has(base)) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      'Refusing to use a protected system directory as the data directory',
      400,
    )
  }
}

function assertNotRepositoryPath(resolved: string): void {
  const repoRoot = findRepositoryRoot()
  if (!repoRoot) {
    return
  }
  const repo = resolve(repoRoot)
  if (
    resolved === repo ||
    isInsideDirectory(repo, resolved) ||
    isInsideDirectory(resolved, repo)
  ) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      'Refusing to use the repository or a path inside it as the data directory',
      400,
    )
  }
}

function assertPathIsNotRepositoryRoot(resolved: string): void {
  const repoRoot = findRepositoryRoot()
  if (!repoRoot) {
    return
  }
  const realRepo = existsSync(repoRoot)
    ? realpathSync(repoRoot)
    : resolve(repoRoot)
  if (resolved === realRepo || isInsideDirectory(realRepo, resolved)) {
    throw new AppError(
      'RESET_REFUSED',
      'Refusing to reset the repository or a parent of the repository',
      400,
    )
  }
}

export function posixRelative(from: string, to: string): string {
  return relative(from, to).split('\\').join('/')
}
