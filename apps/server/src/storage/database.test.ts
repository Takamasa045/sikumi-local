import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import Database from 'better-sqlite3'
import {
  assertSqliteIntegrity,
  backupSqliteDatabase,
  openDatabase,
  restoreSqliteDatabase,
} from './database.js'

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

describe('SQLite snapshot backup and restore', () => {
  it('copies WAL-committed rows into a standalone snapshot and integrity_check passes', () => {
    const dataDirectory = track()
    const live = openLive(dataDirectory)
    live.pragma('wal_autocheckpoint = 0')
    live
      .prepare(
        `INSERT INTO workspaces (id, name, world_pack_id, created_at, updated_at)
         VALUES ('ws_keep', 'keep-me', 'dog-office', 't', 't')`,
      )
      .run()
    expect(live.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(existsSync(join(dataDirectory, 'database.sqlite-wal'))).toBe(true)

    const naive = join(track(), 'naive.sqlite')
    copyFileSync(join(dataDirectory, 'database.sqlite'), naive)
    const naiveHasRow = (() => {
      try {
        const copied = openSqlite(naive)
        return Boolean(
          copied
            .prepare('SELECT name FROM workspaces WHERE id = ?')
            .get('ws_keep'),
        )
      } catch {
        return false
      }
    })()
    expect(naiveHasRow).toBe(false)

    const snapshot = join(track(), 'snapshot.sqlite')
    const before = readFileSync(join(dataDirectory, 'database.sqlite'))
    backupSqliteDatabase(join(dataDirectory, 'database.sqlite'), snapshot)
    const after = readFileSync(join(dataDirectory, 'database.sqlite'))

    expect(after.equals(before)).toBe(true)
    expect(existsSync(`${snapshot}-wal`)).toBe(false)
    expect(assertSqliteIntegrity(snapshot)).toBe('ok')
    expect(
      live.prepare('SELECT name FROM workspaces WHERE id = ?').get('ws_keep'),
    ).toEqual({ name: 'keep-me' })

    live.close()
    const restored = openSqlite(snapshot)
    expect(
      restored
        .prepare('SELECT name FROM workspaces WHERE id = ?')
        .get('ws_keep'),
    ).toEqual({ name: 'keep-me' })
  })

  it('refuses a corrupt snapshot and leaves the current database unchanged', () => {
    const livePath = join(track(), 'database.sqlite')
    writeLiveWorkspace(livePath, 'ws_live', 'original')
    const before = readFileSync(livePath)
    const corrupt = join(track(), 'corrupt.sqlite')
    writeFileSync(
      corrupt,
      Buffer.concat([
        Buffer.from('SQLite format 3\0'),
        Buffer.alloc(200, 0xff),
      ]),
    )

    expect(() => restoreSqliteDatabase(corrupt, livePath)).toThrow(AppError)
    expect(readFileSync(livePath).equals(before)).toBe(true)
    expect(readWorkspaceName(livePath, 'ws_live')).toBe('original')
  })

  it('refuses a partial truncated snapshot and leaves the current database unchanged', () => {
    const livePath = join(track(), 'database.sqlite')
    writeLiveWorkspace(livePath, 'ws_live', 'original')
    const before = readFileSync(livePath)
    const partial = join(track(), 'partial.sqlite')
    writeFileSync(partial, readFileSync(livePath).subarray(0, 64))

    expect(() => restoreSqliteDatabase(partial, livePath)).toThrow(AppError)
    expect(readFileSync(livePath).equals(before)).toBe(true)
    expect(readWorkspaceName(livePath, 'ws_live')).toBe('original')
  })

  it('refuses a non-SQLite payload and leaves the current database unchanged', () => {
    const livePath = join(track(), 'database.sqlite')
    writeLiveWorkspace(livePath, 'ws_live', 'original')
    const before = readFileSync(livePath)
    const fake = join(track(), 'not-sqlite.sqlite')
    writeFileSync(fake, 'not-a-sqlite-file')

    expect(() => restoreSqliteDatabase(fake, livePath)).toThrow(AppError)
    expect(readFileSync(livePath).equals(before)).toBe(true)
    expect(readWorkspaceName(livePath, 'ws_live')).toBe('original')
  })

  it('replaces the current database from a valid snapshot', () => {
    const livePath = join(track(), 'database.sqlite')
    writeLiveWorkspace(livePath, 'ws_live', 'original')
    const snapshot = join(track(), 'snapshot.sqlite')
    backupSqliteDatabase(livePath, snapshot)

    const live = new Database(livePath)
    databases.push(live)
    live
      .prepare(`UPDATE workspaces SET name = 'changed' WHERE id = 'ws_live'`)
      .run()
    live.close()

    restoreSqliteDatabase(snapshot, livePath)
    expect(readWorkspaceName(livePath, 'ws_live')).toBe('original')
    expect(assertSqliteIntegrity(livePath)).toBe('ok')
  })
})

function track(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-database-'))
  tempDirectories.push(directory)
  return directory
}

function openLive(dataDirectory: string): Database.Database {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  const opened = openDatabase(dataDirectory)
  databases.push(opened.sqlite)
  return opened.sqlite
}

function openSqlite(filePath: string): Database.Database {
  const sqlite = new Database(filePath)
  databases.push(sqlite)
  return sqlite
}

function writeLiveWorkspace(filePath: string, id: string, name: string): void {
  const dataDirectory = dirname(filePath)
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
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
