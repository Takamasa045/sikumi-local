import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import Database from 'better-sqlite3'
import { openDatabase } from '../storage/database.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import {
  backupDataDirectory,
  restoreDataDirectoryFromBackup,
} from './backup.js'
import { runSetup } from './setup.js'

const tempDirectories: string[] = []
const databases: Database.Database[] = []

afterEach(() => {
  for (const sqlite of databases.splice(0)) {
    try {
      sqlite.close()
    } catch {
      // Already closed by the test.
    }
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SQLite WAL-consistent backup and restore', () => {
  it('backs up committed WAL data without mutating the live database', () => {
    const dataDirectory = preparedDataDir()
    const live = openLiveDatabase(dataDirectory)
    live
      .prepare(
        `INSERT INTO workspaces (id, name, world_pack_id, created_at, updated_at)
         VALUES ('ws_keep', 'keep-me', 'dog-office', 't', 't')`,
      )
      .run()
    live.pragma('wal_autocheckpoint = 0')
    expect(live.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(existsSync(join(dataDirectory, 'database.sqlite-wal'))).toBe(true)

    const backup = backupDataDirectory(dataDirectory, 'reset')

    expect(
      live.prepare('SELECT name FROM workspaces WHERE id = ?').get('ws_keep'),
    ).toEqual({ name: 'keep-me' })
    expect(existsSync(join(backup.backupDirectory, 'database.sqlite'))).toBe(
      true,
    )
    expect(
      existsSync(join(backup.backupDirectory, 'database.sqlite-wal')),
    ).toBe(false)
    const snapshot = openSqlite(join(backup.backupDirectory, 'database.sqlite'))
    expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(
      snapshot
        .prepare('SELECT name FROM workspaces WHERE id = ?')
        .get('ws_keep'),
    ).toEqual({ name: 'keep-me' })

    live
      .prepare(`UPDATE workspaces SET name = 'changed' WHERE id = 'ws_keep'`)
      .run()
    live.close()

    restoreDataDirectoryFromBackup(dataDirectory, backup.backupDirectory)
    const restored = openSqlite(join(dataDirectory, 'database.sqlite'))
    expect(
      restored
        .prepare('SELECT name FROM workspaces WHERE id = ?')
        .get('ws_keep'),
    ).toEqual({ name: 'keep-me' })
  })

  it('refuses a corrupt backup and leaves the live database unchanged', () => {
    const dataDirectory = preparedDataDir()
    seedWorkspace(dataDirectory, 'ws_live', 'original')
    const backupDirectory = join(dataDirectory, 'backups', 'corrupt-copy')
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(
      join(backupDirectory, 'database.sqlite'),
      Buffer.concat([
        Buffer.from('SQLite format 3\0'),
        Buffer.alloc(200, 0xff),
      ]),
    )

    expect(() =>
      restoreDataDirectoryFromBackup(dataDirectory, backupDirectory),
    ).toThrow(AppError)
    expect(
      readWorkspaceName(join(dataDirectory, 'database.sqlite'), 'ws_live'),
    ).toBe('original')
  })

  it('refuses a partial WAL-only backup and leaves the live database unchanged', () => {
    const dataDirectory = preparedDataDir()
    seedWorkspace(dataDirectory, 'ws_live', 'original')
    const backupDirectory = join(dataDirectory, 'backups', 'partial-copy')
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(join(backupDirectory, 'database.sqlite-wal'), 'wal-only')

    expect(() =>
      restoreDataDirectoryFromBackup(dataDirectory, backupDirectory),
    ).toThrow(AppError)
    expect(
      readWorkspaceName(join(dataDirectory, 'database.sqlite'), 'ws_live'),
    ).toBe('original')
  })

  it('refuses a non-SQLite backup over a live database and leaves it unchanged', () => {
    const dataDirectory = preparedDataDir()
    seedWorkspace(dataDirectory, 'ws_live', 'original')
    const backupDirectory = join(dataDirectory, 'backups', 'opaque-copy')
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(join(backupDirectory, 'database.sqlite'), 'not-a-sqlite-file')

    expect(() =>
      restoreDataDirectoryFromBackup(dataDirectory, backupDirectory),
    ).toThrow(AppError)
    expect(
      readWorkspaceName(join(dataDirectory, 'database.sqlite'), 'ws_live'),
    ).toBe('original')
  })

  it('refuses a backup that omits the live database and leaves it unchanged', () => {
    const dataDirectory = preparedDataDir()
    seedWorkspace(dataDirectory, 'ws_live', 'original')
    const backupDirectory = join(dataDirectory, 'backups', 'no-db-copy')
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(join(backupDirectory, 'config.json'), '{"ok":true}')

    expect(() =>
      restoreDataDirectoryFromBackup(dataDirectory, backupDirectory),
    ).toThrow(AppError)
    expect(
      readWorkspaceName(join(dataDirectory, 'database.sqlite'), 'ws_live'),
    ).toBe('original')
  })

  it('refuses an empty database file in the backup', () => {
    const dataDirectory = preparedDataDir()
    seedWorkspace(dataDirectory, 'ws_live', 'original')
    const backupDirectory = join(dataDirectory, 'backups', 'empty-copy')
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(join(backupDirectory, 'database.sqlite'), '')

    expect(() =>
      restoreDataDirectoryFromBackup(dataDirectory, backupDirectory),
    ).toThrow(AppError)
    expect(
      readWorkspaceName(join(dataDirectory, 'database.sqlite'), 'ws_live'),
    ).toBe('original')
  })
})

function preparedDataDir(): string {
  const dataDirectory = track(createTemporaryDirectory())
  runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
  return dataDirectory
}

function openLiveDatabase(dataDirectory: string): Database.Database {
  const opened = openDatabase(dataDirectory)
  databases.push(opened.sqlite)
  return opened.sqlite
}

function openSqlite(filePath: string): Database.Database {
  const sqlite = new Database(filePath)
  databases.push(sqlite)
  return sqlite
}

function seedWorkspace(dataDirectory: string, id: string, name: string): void {
  const opened = openDatabase(dataDirectory)
  opened.sqlite
    .prepare(
      `INSERT INTO workspaces (id, name, world_pack_id, created_at, updated_at)
       VALUES (?, ?, 'dog-office', 't', 't')`,
    )
    .run(id, name)
  opened.sqlite.close()
}

function readWorkspaceName(filePath: string, id: string): string {
  const sqlite = openSqlite(filePath)
  const row = sqlite
    .prepare('SELECT name FROM workspaces WHERE id = ?')
    .get(id) as { name: string } | undefined
  return row?.name ?? ''
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
