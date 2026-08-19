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
import {
  assertSqliteIntegrity,
  backupSqliteDatabase,
  isSqliteDatabaseFile,
  restoreSqliteDatabase,
} from '../storage/database.js'
import { assertSafeDataDirectoryInput, isInsideDirectory } from './paths.js'

const SQLITE_SIDECAR_NAMES = new Set([
  'database.sqlite-wal',
  'database.sqlite-shm',
  'database.sqlite-journal',
])

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
  'observer',
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
    if (entry === 'backups' || SQLITE_SIDECAR_NAMES.has(entry)) {
      continue
    }
    const source = join(resolved, entry)
    const destination = join(backupDirectory, entry)
    if (entry === 'database.sqlite' && isSqliteDatabaseFile(source)) {
      backupSqliteDatabase(source, destination)
      copied.push(entry)
      continue
    }
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
  assertRestorableSqliteBackup(backupDirectory, resolved)
  const backupDb = databaseFilePath(backupDirectory)
  const restoredSqlite = isSqliteDatabaseFile(backupDb)
  if (restoredSqlite) {
    restoreSqliteDatabase(backupDb, databaseFilePath(resolved))
  }
  clearOwnedEntries(resolved, {
    keepBackups: true,
    keepDatabase: restoredSqlite,
  })
  for (const entry of readdirSync(backupDirectory)) {
    if (
      entry === 'backups' ||
      entry === '.' ||
      entry === '..' ||
      SQLITE_SIDECAR_NAMES.has(entry) ||
      (restoredSqlite && entry === 'database.sqlite')
    ) {
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
  options: {
    readonly keepBackups?: boolean
    readonly keepDatabase?: boolean
  } = {},
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
    if (options.keepDatabase && entry === 'database.sqlite') {
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

function assertRestorableSqliteBackup(
  backupDirectory: string,
  dataDirectory: string,
): void {
  const dbPath = databaseFilePath(backupDirectory)
  const hasSidecar = [...SQLITE_SIDECAR_NAMES].some((name) =>
    existsSync(join(backupDirectory, name)),
  )
  if (hasSidecar && !existsSync(dbPath)) {
    throw new AppError(
      'BACKUP_FAILED',
      'SQLite backup is partial and cannot be restored',
      400,
    )
  }
  if (!existsSync(dbPath)) {
    const liveDb = databaseFilePath(dataDirectory)
    if (existsSync(liveDb) && lstatSync(liveDb).isFile()) {
      throw new AppError(
        'BACKUP_FAILED',
        'SQLite backup is partial and cannot be restored',
        400,
      )
    }
    return
  }
  const stat = lstatSync(dbPath)
  if (!stat.isFile() || stat.size === 0) {
    throw new AppError(
      'BACKUP_FAILED',
      'SQLite backup is missing or partial',
      400,
    )
  }
  if (!isSqliteDatabaseFile(dbPath)) {
    const liveDb = databaseFilePath(dataDirectory)
    if (isSqliteDatabaseFile(liveDb)) {
      throw new AppError(
        'BACKUP_FAILED',
        'SQLite backup is corrupt or unreadable',
        400,
      )
    }
    return
  }
  assertSqliteIntegrity(dbPath)
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
