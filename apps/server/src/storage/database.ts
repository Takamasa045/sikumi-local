import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { AppError } from '@sikumi-local/core'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { databaseFilePath } from './data-directory.js'
import { applyMigrations } from './migrate.js'
import * as schema from './schema.js'

const SQLITE_HEADER = Buffer.from('SQLite format 3\0')
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const

export type AppDatabase = BetterSQLite3Database<typeof schema>

export interface OpenedDatabase {
  readonly sqlite: Database.Database
  readonly db: AppDatabase
  readonly filePath: string
}

export function openDatabase(dataDirectory: string): OpenedDatabase {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  const filePath = databaseFilePath(dataDirectory)
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  applyMigrations(sqlite)
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    filePath,
  }
}

export function isSqliteDatabaseFile(filePath: string): boolean {
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    return false
  }
  if (lstatSync(filePath).size < SQLITE_HEADER.length) {
    return false
  }
  const header = Buffer.alloc(SQLITE_HEADER.length)
  const fd = openSync(filePath, 'r')
  try {
    const bytesRead = readSync(fd, header, 0, header.length, 0)
    return bytesRead === header.length && header.equals(SQLITE_HEADER)
  } finally {
    closeSync(fd)
  }
}

export function assertSqliteIntegrity(filePath: string): 'ok' {
  if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
    throw new AppError(
      'BACKUP_FAILED',
      'SQLite backup is missing or unreadable',
      400,
    )
  }
  if (lstatSync(filePath).size === 0) {
    throw new AppError(
      'BACKUP_FAILED',
      'SQLite backup is missing or partial',
      400,
    )
  }
  let sqlite: Database.Database
  try {
    sqlite = new Database(filePath, { readonly: true, fileMustExist: true })
  } catch {
    throw new AppError(
      'BACKUP_FAILED',
      'SQLite backup is corrupt or unreadable',
      400,
    )
  }
  try {
    const result = sqlite.pragma('integrity_check', { simple: true })
    if (result !== 'ok') {
      throw new AppError(
        'BACKUP_FAILED',
        'SQLite backup failed integrity_check',
        400,
      )
    }
    return 'ok'
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError(
      'BACKUP_FAILED',
      'SQLite backup failed integrity_check',
      400,
    )
  } finally {
    sqlite.close()
  }
}

export function backupSqliteDatabase(
  sourcePath: string,
  destinationPath: string,
): void {
  if (!existsSync(sourcePath)) {
    throw new AppError('BACKUP_FAILED', 'SQLite database was not found', 400)
  }
  mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 })
  removeSqliteBundle(destinationPath)
  const source = new Database(sourcePath, { fileMustExist: true })
  try {
    source.exec(`VACUUM INTO '${escapeSqliteLiteral(destinationPath)}'`)
  } catch (error) {
    removeSqliteBundle(destinationPath)
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError(
      'BACKUP_FAILED',
      'Failed to create a consistent SQLite snapshot',
      500,
    )
  } finally {
    source.close()
  }
  try {
    finalizeStandaloneSqlite(destinationPath)
    assertSqliteIntegrity(destinationPath)
  } catch (error) {
    removeSqliteBundle(destinationPath)
    throw error
  }
}

export function restoreSqliteDatabase(
  backupPath: string,
  destinationPath: string,
): void {
  assertSqliteIntegrity(backupPath)
  const tempPath = `${destinationPath}.restore-tmp`
  try {
    backupSqliteDatabase(backupPath, tempPath)
    const previousPath = sqliteBundleExists(destinationPath)
      ? `${destinationPath}.previous`
      : undefined
    if (previousPath) {
      renameSqliteBundle(destinationPath, previousPath)
    }
    try {
      renameSync(tempPath, destinationPath)
      removeSqliteSidecars(destinationPath)
    } catch (error) {
      if (previousPath) {
        renameSqliteBundle(previousPath, destinationPath)
      }
      throw error
    }
    if (previousPath) {
      removeSqliteBundle(previousPath)
    }
  } finally {
    if (existsSync(tempPath)) {
      rmSync(tempPath)
    }
  }
}

function sqliteBundleExists(filePath: string): boolean {
  return (
    existsSync(filePath) ||
    SQLITE_SIDECAR_SUFFIXES.some((suffix) => existsSync(`${filePath}${suffix}`))
  )
}

function renameSqliteBundle(fromPath: string, toPath: string): void {
  removeSqliteBundle(toPath)
  if (existsSync(fromPath)) {
    renameSync(fromPath, toPath)
  }
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const source = `${fromPath}${suffix}`
    if (existsSync(source)) {
      renameSync(source, `${toPath}${suffix}`)
    }
  }
}

function removeSqliteBundle(filePath: string): void {
  removeSqliteSidecars(filePath)
  if (existsSync(filePath)) {
    rmSync(filePath)
  }
}

function removeSqliteSidecars(filePath: string): void {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sidecar = `${filePath}${suffix}`
    if (existsSync(sidecar)) {
      rmSync(sidecar)
    }
  }
}

function finalizeStandaloneSqlite(filePath: string): void {
  const sqlite = new Database(filePath, { fileMustExist: true })
  try {
    sqlite.pragma('journal_mode = DELETE')
    sqlite.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    sqlite.close()
  }
  removeSqliteSidecars(filePath)
}

function escapeSqliteLiteral(value: string): string {
  return value.replaceAll("'", "''")
}
