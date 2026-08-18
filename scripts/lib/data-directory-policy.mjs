import { existsSync, lstatSync, mkdirSync, chmodSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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

export function findRepositoryRoot(
  start = fileURLToPath(new URL('.', import.meta.url)),
) {
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

export function assertSafeDataDirectoryInput(input, options = {}) {
  const trimmed = String(input ?? '').trim()
  if (trimmed.length === 0) {
    throw new Error('Data directory is required')
  }
  if (trimmed.length > MAX_PATH_LENGTH) {
    throw new Error('Data directory is too long')
  }
  if (trimmed.includes('\0') || trimmed.split(/[/\\]/).includes('..')) {
    throw new Error('Data directory is not safe')
  }
  if (!isAbsolute(trimmed)) {
    throw new Error('Data directory must be an absolute path')
  }
  const resolved = resolve(trimmed)
  if (resolved.split(/[/\\]/).includes('..')) {
    throw new Error('Data directory is not safe')
  }
  assertNotProtectedSystemPath(resolved)
  assertNotRepositoryPath(resolved, options.repoRoot)
  assertNoSymlinkAlongPath(resolved)
  return resolved
}

export function assertNoSymlinkAlongPath(target) {
  const resolved = resolve(target)
  const { root } = parse(resolved)
  const parts = resolved
    .slice(root.length)
    .split(/[/\\]/)
    .filter((part) => part.length > 0)
  let current =
    root.endsWith(sep) || root.endsWith('/') ? root : `${root}${sep}`
  if (root && existsSync(root)) {
    const rootStat = lstatSync(root)
    if (rootStat.isSymbolicLink()) {
      throw new Error('Refusing to follow a symlink ancestor')
    }
  }
  for (const part of parts) {
    current = current.endsWith(sep) ? `${current}${part}` : join(current, part)
    if (!existsSync(current)) {
      continue
    }
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to follow a symlink: ${part}`)
    }
  }
}

export function mkdirSecureRecursive(target) {
  const resolved = resolve(target)
  assertNoSymlinkAlongPath(resolved)
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
        throw new Error(`Refusing to follow a symlink: ${part}`)
      }
      if (!stat.isDirectory()) {
        throw new Error(`Refusing to replace a non-directory: ${part}`)
      }
      continue
    }
    mkdirSync(current, { mode: SECURE_DIRECTORY_MODE })
  }
  try {
    chmodSync(resolved, SECURE_DIRECTORY_MODE)
  } catch {
    // Best-effort on existing directories.
  }
  return resolved
}

export function isProtectedSystemPath(resolved) {
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
    return true
  }
  const { root, base } = parse(resolved)
  return resolved === root || PROTECTED_BASENAMES.has(base)
}

function assertNotProtectedSystemPath(resolved) {
  if (isProtectedSystemPath(resolved)) {
    throw new Error(
      'Refusing to use a protected system directory as the data directory',
    )
  }
}

function assertNotRepositoryPath(resolved, repoRoot = findRepositoryRoot()) {
  if (!repoRoot) {
    return
  }
  const repo = resolve(repoRoot)
  if (
    resolved === repo ||
    isInside(repo, resolved) ||
    isInside(resolved, repo)
  ) {
    throw new Error(
      'Refusing to use the repository or a path inside it as the data directory',
    )
  }
}

function isInside(candidate, root) {
  return candidate === root || candidate.startsWith(root + sep)
}
