import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase } from '../storage/database.js'
import { databaseFilePath } from '../storage/data-directory.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { backupDataDirectory } from './backup.js'
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

describe('backup consistency', () => {
  it('captures committed WAL pages in a standalone sqlite file without sidecars', () => {
    const dataDirectory = preparedDataDir()
    const live = openLive(dataDirectory)
    live.pragma('wal_autocheckpoint = 0')
    live
      .prepare(
        `INSERT INTO workspaces (id, name, world_pack_id, created_at, updated_at)
         VALUES ('ws_wal', 'from-wal', 'dog-office', 't', 't')`,
      )
      .run()
    expect(live.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(existsSync(join(dataDirectory, 'database.sqlite-wal'))).toBe(true)

    const naiveCopy = join(track(createTemporaryDirectory()), 'naive.sqlite')
    copyFileSync(databaseFilePath(dataDirectory), naiveCopy)
    const naiveHasWalRow = (() => {
      try {
        const naive = openSqlite(naiveCopy)
        return Boolean(
          naive
            .prepare('SELECT name FROM workspaces WHERE id = ?')
            .get('ws_wal'),
        )
      } catch {
        return false
      }
    })()
    expect(naiveHasWalRow).toBe(false)

    const backup = backupDataDirectory(dataDirectory, 'reset')
    expect(
      existsSync(join(backup.backupDirectory, 'database.sqlite-wal')),
    ).toBe(false)
    expect(
      existsSync(join(backup.backupDirectory, 'database.sqlite-shm')),
    ).toBe(false)

    const isolated = join(track(createTemporaryDirectory()), 'snapshot.sqlite')
    copyFileSync(join(backup.backupDirectory, 'database.sqlite'), isolated)
    const snapshot = openSqlite(isolated)
    expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(
      snapshot
        .prepare('SELECT name FROM workspaces WHERE id = ?')
        .get('ws_wal'),
    ).toEqual({ name: 'from-wal' })
    expect(
      live.prepare('SELECT name FROM workspaces WHERE id = ?').get('ws_wal'),
    ).toEqual({ name: 'from-wal' })
  })
})

function preparedDataDir(): string {
  const dataDirectory = track(createTemporaryDirectory())
  runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
  return dataDirectory
}

function openLive(dataDirectory: string): Database.Database {
  const opened = openDatabase(dataDirectory)
  databases.push(opened.sqlite)
  return opened.sqlite
}

function openSqlite(filePath: string): Database.Database {
  const sqlite = new Database(filePath)
  databases.push(sqlite)
  return sqlite
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
