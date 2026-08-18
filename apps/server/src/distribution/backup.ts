import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { AppError } from '@sikumi-local/core'
import {
  backupsDirectory,
  databaseFilePath,
} from '../storage/data-directory.js'
import { assertSafeDataDirectoryInput, isInsideDirectory } from './paths.js'

export const DATA_DIRECTORY_OWNED_NAMES = new Set([
  '.shikumi-local.json',
  'database.sqlite',
  'database.sqlite-wal',
  'database.sqlite-shm',
  'database.sqlite-journal',
  'config.json',
  'reports',
  'artifacts',
  'exports',
  'packs',
  'worktrees',
  'cache',
  'logs',
  'backups',
  'employees',
  'worlds',
  'characters',
])

export interface DirectoryBackupResult {
  readonly backupDirectory: string
  readonly copied: readonly string[]
}

export function createTimestampLabel(now = new Date()): string {
  return now.toISOString().replaceAll(':', '').replaceAll('.', '-')
}

export function backupDataDirectory(
  dataDirectory: string,
  reason: 'reset' | 'import',
  now = new Date(),
): DirectoryBackupResult {
  const resolved = assertSafeDataDirectoryInput(dataDirectory)
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
    throw new AppError(
      'BACKUP_FAILED',
      'Refusing to backup a data directory that is a symlink',
      400,
    )
  }
  const backupsRoot = backupsDirectory(resolved)
  mkdirSync(backupsRoot, { recursive: true, mode: 0o700 })
  const backupDirectory = join(
    backupsRoot,
    `${reason}-${createTimestampLabel(now)}`,
  )
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
  const copied: string[] = []
  for (const entry of listOwnedEntries(resolved)) {
    if (entry === 'backups') {
      continue
    }
    const source = join(resolved, entry)
    const destination = join(backupDirectory, entry)
    copyOwnedEntry(source, destination, resolved)
    copied.push(entry)
  }
  return { backupDirectory, copied }
}

export function restoreDataDirectoryFromBackup(
  dataDirectory: string,
  backupDirectory: string,
): void {
  const resolved = assertSafeDataDirectoryInput(dataDirectory)
  if (
    !existsSync(backupDirectory) ||
    !lstatSync(backupDirectory).isDirectory()
  ) {
    throw new AppError('BACKUP_FAILED', 'Backup directory was not found', 400)
  }
  if (lstatSync(backupDirectory).isSymbolicLink()) {
    throw new AppError(
      'BACKUP_FAILED',
      'Refusing to restore from a symlink backup',
      400,
    )
  }
  clearOwnedEntries(resolved, { keepBackups: true })
  for (const entry of readdirSync(backupDirectory)) {
    if (entry === 'backups' || entry === '.' || entry === '..') {
      continue
    }
    copyOwnedEntry(
      join(backupDirectory, entry),
      join(resolved, entry),
      resolved,
    )
  }
}

export function clearOwnedEntries(
  dataDirectory: string,
  options: { readonly keepBackups?: boolean } = {},
): void {
  const resolved = assertSafeDataDirectoryInput(dataDirectory)
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
    throw new AppError(
      'RESET_REFUSED',
      'Refusing to modify a data directory that is a symlink',
      400,
    )
  }
  for (const entry of listOwnedEntries(resolved)) {
    if (options.keepBackups && entry === 'backups') {
      continue
    }
    removeOwnedEntry(join(resolved, entry), resolved)
  }
}

export function listOwnedEntries(dataDirectory: string): string[] {
  if (!existsSync(dataDirectory)) {
    return []
  }
  return readdirSync(dataDirectory).filter((entry) =>
    DATA_DIRECTORY_OWNED_NAMES.has(entry),
  )
}

function copyOwnedEntry(
  source: string,
  destination: string,
  dataRoot: string,
): void {
  if (!existsSync(source)) {
    return
  }
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      `Refusing to copy symlink ${basename(source)}`,
      400,
    )
  }
  if (
    !isInsideDirectory(source, dataRoot) &&
    source !== databaseFilePath(dataRoot)
  ) {
    throw new AppError(
      'PATH_TRAVERSAL',
      'Backup source escapes the data directory',
      400,
    )
  }
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true, mode: 0o700 })
    for (const child of readdirSync(source)) {
      copyOwnedEntry(join(source, child), join(destination, child), source)
    }
    return
  }
  if (!stat.isFile()) {
    throw new AppError(
      'DATA_DIRECTORY_UNSAFE',
      `Unsupported data entry ${basename(source)}`,
      400,
    )
  }
  cpSync(source, destination, { dereference: false })
}

function removeOwnedEntry(target: string, dataRoot: string): void {
  if (!existsSync(target)) {
    return
  }
  if (lstatSync(target).isSymbolicLink()) {
    throw new AppError(
      'RESET_REFUSED',
      `Refusing to delete symlink ${basename(target)}`,
      400,
    )
  }
  if (!isInsideDirectory(target, dataRoot)) {
    throw new AppError(
      'PATH_TRAVERSAL',
      'Reset target escapes the data directory',
      400,
    )
  }
  rmSync(target, { recursive: true, force: false })
}
