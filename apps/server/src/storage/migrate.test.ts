import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMigrations, type Migration } from './migrate.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('applyMigrations', () => {
  it('creates the domain schema on a new database', () => {
    const sqlite = openTempDatabase()

    applyMigrations(sqlite)

    const tables = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      )
      .all() as Array<{ name: string }>

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'schema_migrations',
        'workspaces',
        'repositories',
        'employees',
        'jobs',
        'runs',
        'events',
        'approval_requests',
        'artifacts',
        'growth_records',
        'installed_packs',
      ]),
    )
  })

  it('is safe to re-run against an existing database after restart', () => {
    const filePath = join(createTempDirectory(), 'database.sqlite')
    const first = new Database(filePath)
    applyMigrations(first)
    first
      .prepare(
        `INSERT INTO workspaces (id, name, world_pack_id, created_at, updated_at)
         VALUES ('ws_1', 'keep-me', 'dog-office', 't', 't')`,
      )
      .run()
    first.close()

    const second = new Database(filePath)
    applyMigrations(second)
    applyMigrations(second)

    const workspace = second
      .prepare('SELECT name FROM workspaces WHERE id = ?')
      .get('ws_1') as { name: string }
    const migrations = second
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number }

    expect(workspace.name).toBe('keep-me')
    expect(migrations.count).toBe(2)
    second.close()
  })

  it('applies only pending versions when the schema grows', () => {
    const sqlite = openTempDatabase()
    const first: Migration = {
      version: 1,
      name: 'one',
      sql: 'CREATE TABLE items (id TEXT PRIMARY KEY);',
    }
    const second: Migration = {
      version: 2,
      name: 'two',
      sql: 'ALTER TABLE items ADD COLUMN label TEXT;',
    }

    applyMigrations(sqlite, [first])
    sqlite.prepare(`INSERT INTO items (id) VALUES ('a')`).run()
    applyMigrations(sqlite, [first, second])

    const columns = sqlite.prepare('PRAGMA table_info(items)').all() as Array<{
      name: string
    }>
    const versions = sqlite
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>

    expect(columns.map((column) => column.name)).toEqual(['id', 'label'])
    expect(versions.map((row) => row.version)).toEqual([1, 2])
  })
})

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-migrate-'))
  tempDirectories.push(directory)
  return directory
}

function openTempDatabase(): Database.Database {
  return new Database(join(createTempDirectory(), 'database.sqlite'))
}
