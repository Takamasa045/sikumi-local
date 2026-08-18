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
    expect(migrations.count).toBe(3)
    const columns = second
      .prepare('PRAGMA table_info(workspaces)')
      .all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('employee_name')
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

  it('rolls back table, index, data, and version when a migration fails mid-step', () => {
    const sqlite = openTempDatabase()
    // Match production: foreign_keys is a connection-level pragma and must
    // stay outside the per-migration BEGIN IMMEDIATE transaction.
    sqlite.pragma('foreign_keys = ON')

    const initial: Migration = {
      version: 1,
      name: 'one',
      sql: 'CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL);',
    }
    const broken: Migration = {
      version: 2,
      name: 'broken',
      sql: `
        CREATE TABLE extra (
          id TEXT PRIMARY KEY NOT NULL,
          item_id TEXT NOT NULL REFERENCES items(id)
        );
        CREATE INDEX extra_item_id_idx ON extra(item_id);
        CREATE INDEX items_partial_idx ON items(id);
        INSERT INTO extra (id, item_id) VALUES ('row', 'keep');
        INSERT INTO items (id) VALUES ('partial');
        INSERT INTO extra (id, item_id) VALUES (NULL, 'keep');
      `,
    }
    const fixed: Migration = {
      version: 2,
      name: 'fixed',
      sql: `
        CREATE TABLE extra (
          id TEXT PRIMARY KEY NOT NULL,
          item_id TEXT NOT NULL REFERENCES items(id)
        );
        CREATE INDEX extra_item_id_idx ON extra(item_id);
        INSERT INTO extra (id, item_id) VALUES ('ok', 'keep');
      `,
    }

    applyMigrations(sqlite, [initial])
    sqlite.prepare(`INSERT INTO items (id) VALUES ('keep')`).run()

    expect(() => applyMigrations(sqlite, [initial, broken])).toThrow()

    expect(listUserTables(sqlite)).toEqual(['items', 'schema_migrations'])
    expect(listUserIndexes(sqlite)).toEqual([])
    expect(sqlite.prepare('SELECT id FROM items ORDER BY id').all()).toEqual([
      { id: 'keep' },
    ])
    expect(
      sqlite
        .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual([{ version: 1, name: 'one' }])

    applyMigrations(sqlite, [initial, fixed])

    expect(listUserTables(sqlite)).toEqual([
      'extra',
      'items',
      'schema_migrations',
    ])
    expect(listUserIndexes(sqlite)).toEqual(['extra_item_id_idx'])
    expect(
      sqlite.prepare('SELECT id, item_id FROM extra ORDER BY id').all(),
    ).toEqual([{ id: 'ok', item_id: 'keep' }])
    expect(sqlite.prepare('SELECT id FROM items ORDER BY id').all()).toEqual([
      { id: 'keep' },
    ])
    expect(
      sqlite
        .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual([
      { version: 1, name: 'one' },
      { version: 2, name: 'fixed' },
    ])
  })
})

function listUserTables(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function listUserIndexes(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-migrate-'))
  tempDirectories.push(directory)
  return directory
}

function openTempDatabase(): Database.Database {
  return new Database(join(createTempDirectory(), 'database.sqlite'))
}
