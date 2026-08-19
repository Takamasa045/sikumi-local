import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyMigrations,
  initialSchemaMigration,
  conflictAttributionMigration,
  conflictEngineMigration,
  observerFoundationMigration,
  workspaceEmployeeNameMigration,
  worktreeGrowthPacksMigration,
  type Migration,
} from './migrate.js'

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
        'observer_adapters',
        'external_sessions',
        'observer_events',
        'resource_claims',
        'repository_snapshots',
        'conflict_findings',
        'session_labels',
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
    expect(migrations.count).toBe(6)
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

  it('keeps existing job, run, and event rows when applying observer v4', () => {
    const sqlite = openTempDatabase()
    applyMigrations(sqlite, [
      initialSchemaMigration,
      worktreeGrowthPacksMigration,
      workspaceEmployeeNameMigration,
    ])
    sqlite
      .prepare(
        `INSERT INTO workspaces (id, name, world_pack_id, created_at, updated_at, employee_name)
         VALUES ('ws_keep', 'kept', 'dog-office', 't', 't', '番')`,
      )
      .run()
    sqlite
      .prepare(
        `INSERT INTO jobs (id, workspace_id, employee_id, request, job_type, selected_provider, permission_profile, status, created_at)
         VALUES ('job_keep', 'ws_keep', 'saguru', '調べて', 'research', 'codex', 'research', 'completed', 't')`,
      )
      .run()
    sqlite
      .prepare(
        `INSERT INTO runs (id, job_id, provider_id, status, created_at)
         VALUES ('run_keep', 'job_keep', 'codex', 'completed', 't')`,
      )
      .run()
    sqlite
      .prepare(
        `INSERT INTO events (id, job_id, run_id, type, payload, occurred_at)
         VALUES ('evt_keep', 'job_keep', 'run_keep', 'run.completed', '{"summary":"完了"}', 't')`,
      )
      .run()

    applyMigrations(sqlite, [
      initialSchemaMigration,
      worktreeGrowthPacksMigration,
      workspaceEmployeeNameMigration,
      observerFoundationMigration,
    ])

    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM jobs').get() as {
        count: number
      },
    ).toEqual({ count: 1 })
    expect(
      sqlite.prepare('SELECT request FROM jobs WHERE id = ?').get('job_keep'),
    ).toEqual({ request: '調べて' })
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM runs').get() as {
        count: number
      },
    ).toEqual({ count: 1 })
    expect(
      sqlite.prepare('SELECT payload FROM events WHERE id = ?').get('evt_keep'),
    ).toEqual({ payload: '{"summary":"完了"}' })
    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'observer_events'`,
        )
        .get(),
    ).toEqual({ name: 'observer_events' })
  })

  it('adds conflict engine columns without dropping existing findings', () => {
    const sqlite = openTempDatabase()
    applyMigrations(sqlite, [
      initialSchemaMigration,
      worktreeGrowthPacksMigration,
      workspaceEmployeeNameMigration,
      observerFoundationMigration,
    ])
    sqlite
      .prepare(
        `INSERT INTO conflict_findings (
           id, repository_id, left_session_id, right_session_id,
           left_worktree_path, right_worktree_path, level, score, confidence,
           summary, reason_json, status, detected_at, updated_at, resolved_at
         ) VALUES (
           'cnf_keep', 'repo_1', 's1', 's2', '/a', '/b', 'high', 82, 'verified',
           '同じファイル', '["同じファイル"]', 'open', 't', 't', NULL
         )`,
      )
      .run()

    applyMigrations(sqlite, [
      initialSchemaMigration,
      worktreeGrowthPacksMigration,
      workspaceEmployeeNameMigration,
      observerFoundationMigration,
      conflictEngineMigration,
    ])

    const row = sqlite
      .prepare(
        `SELECT identity_key, headline, recommendation, evidence_json, fingerprint
         FROM conflict_findings WHERE id = 'cnf_keep'`,
      )
      .get() as {
      identity_key: string
      headline: string
      recommendation: string
      evidence_json: string
      fingerprint: string
    }
    expect(row.identity_key).toBe('cnf_keep')
    expect(row.headline).toBe('同じファイル')
    expect(row.recommendation).toContain('自動操作')
    expect(row.evidence_json).toBe('[]')
    expect(row.fingerprint).toBe('cnf_keep')
    const columns = sqlite
      .prepare('PRAGMA table_info(conflict_findings)')
      .all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'identity_key',
        'headline',
        'recommendation',
        'evidence_json',
        'fingerprint',
        'left_source',
        'right_source',
      ]),
    )
  })

  it('adds per-side attribution columns without dropping existing findings', () => {
    const sqlite = openTempDatabase()
    applyMigrations(sqlite, [
      initialSchemaMigration,
      worktreeGrowthPacksMigration,
      workspaceEmployeeNameMigration,
      observerFoundationMigration,
      conflictEngineMigration,
    ])
    sqlite
      .prepare(
        `INSERT INTO conflict_findings (
           id, repository_id, left_session_id, right_session_id,
           left_worktree_path, right_worktree_path, left_source, right_source,
           level, score, confidence, headline, summary, recommendation,
           reason_json, evidence_json, identity_key, fingerprint, status,
           detected_at, updated_at, resolved_at
         ) VALUES (
           'cnf_attr', 'repo_1', 's1', 's2', '/a', '/b', 'codex', 'cursor',
           'high', 82, 'inferred', '同じファイル', '同じファイル', '自動操作はしません。',
           '["同じファイル"]', '[]', 'cnf_attr', 'cnf_attr', 'open', 't', 't', NULL
         )`,
      )
      .run()

    applyMigrations(sqlite, [
      initialSchemaMigration,
      worktreeGrowthPacksMigration,
      workspaceEmployeeNameMigration,
      observerFoundationMigration,
      conflictEngineMigration,
      conflictAttributionMigration,
    ])

    const row = sqlite
      .prepare(
        `SELECT left_source, right_source, left_attribution_confidence, right_attribution_confidence
         FROM conflict_findings WHERE id = 'cnf_attr'`,
      )
      .get() as {
      left_source: string
      right_source: string
      left_attribution_confidence: string | null
      right_attribution_confidence: string | null
    }
    expect(row.left_source).toBe('codex')
    expect(row.right_source).toBe('cursor')
    expect(row.left_attribution_confidence).toBeNull()
    expect(row.right_attribution_confidence).toBeNull()
    const columns = sqlite
      .prepare('PRAGMA table_info(conflict_findings)')
      .all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'left_attribution_confidence',
        'right_attribution_confidence',
      ]),
    )
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
