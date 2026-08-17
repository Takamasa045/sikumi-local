import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { databaseFilePath } from './data-directory.js'
import { applyMigrations } from './migrate.js'
import * as schema from './schema.js'

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
