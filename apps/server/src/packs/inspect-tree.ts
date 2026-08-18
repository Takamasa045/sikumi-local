import {
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { extname, join, relative } from 'node:path'
import { AppError } from '@sikumi-local/core'
import {
  FORBIDDEN_PACK_EXTENSIONS,
  MAX_PACK_DEPTH,
  MAX_PACK_FILE_BYTES,
  MAX_PACK_FILES,
  MAX_PACK_TOTAL_BYTES,
} from '@sikumi-local/employee-sdk'
import { isInsideRoot } from '@sikumi-local/process-runtime'

const FORBIDDEN_NAMES = new Set([
  'package.json',
  'postinstall',
  'preinstall',
  '.gitmodules',
  '.gitattributes',
  '.git',
  '.env',
  '.npmrc',
  '.netrc',
  '.git-credentials',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'credentials',
  'credentials.json',
])

const FORBIDDEN_EXTENSIONS = new Set([
  ...FORBIDDEN_PACK_EXTENSIONS,
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.asc',
])

const FORBIDDEN_DIRECTORIES = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
  'credentials',
])

const EXECUTABLE_MODE = 0o111

export interface PackTreeSummary {
  readonly files: number
  readonly totalBytes: number
  readonly names: readonly string[]
}

export function inspectDataOnlyTree(root: string): PackTreeSummary {
  let files = 0
  let totalBytes = 0
  const names: string[] = []
  if (!existsSync(root)) {
    throw packError('Pack was not found')
  }
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    throw packError('Pack was not found')
  }

  function walk(directory: string, depth: number): void {
    if (depth > MAX_PACK_DEPTH) {
      throw packError('Pack exceeds the maximum directory depth')
    }
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') {
        continue
      }
      const fullPath = join(directory, entry.name)
      if (entry.isSymbolicLink() || isSymlink(fullPath)) {
        throw packError('Pack must not contain symlinks')
      }
      const lower = entry.name.toLowerCase()
      if (FORBIDDEN_DIRECTORIES.has(lower) || lower === '.git') {
        throw packError(
          `Pack must be data-only (forbidden path: ${entry.name})`,
        )
      }
      if (
        lower.startsWith('.env') ||
        FORBIDDEN_NAMES.has(lower) ||
        lower.startsWith('credentials')
      ) {
        throw packError(
          `Pack must be data-only (forbidden file: ${entry.name})`,
        )
      }
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile()) {
        throw packError('Pack contains an unsupported file type')
      }
      files += 1
      if (files > MAX_PACK_FILES) {
        throw packError('Pack has too many files')
      }
      const extension = extname(entry.name).toLowerCase()
      if (FORBIDDEN_EXTENSIONS.has(extension)) {
        throw packError(
          `Pack must be data-only (forbidden file: ${entry.name})`,
        )
      }
      const stat = statSync(fullPath)
      if ((stat.mode & EXECUTABLE_MODE) !== 0) {
        throw packError(`Pack must not contain executables: ${entry.name}`)
      }
      if (stat.size > MAX_PACK_FILE_BYTES) {
        throw packError(`Pack file is too large: ${entry.name}`)
      }
      totalBytes += stat.size
      if (totalBytes > MAX_PACK_TOTAL_BYTES) {
        throw packError('Pack exceeds the maximum total size')
      }
      const real = realpathSync(fullPath)
      if (!isInsideRoot(real, realRoot)) {
        throw packError('Pack file escapes the pack root')
      }
      names.push(relative(realRoot, real).split('\\').join('/'))
    }
  }

  walk(realRoot, 1)
  return { files, totalBytes, names: names.sort() }
}

export function packError(message: string): AppError {
  return new AppError('PACK_INVALID', message, 400)
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
