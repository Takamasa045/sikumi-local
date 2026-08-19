import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_LAYOUT_MARKER = '.shikumi-local.json'
export const DATA_LAYOUT_VERSION = 1

export const DATA_SUBDIRECTORIES = [
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
] as const

export function observerDirectory(dataDirectory: string): string {
  return join(dataDirectory, 'observer')
}

export function resolveDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.SIKUMI_LOCAL_DATA_DIR ?? join(homedir(), '.shikumi-local')
}

export function databaseFilePath(dataDirectory: string): string {
  return join(dataDirectory, 'database.sqlite')
}

export function layoutMarkerPath(dataDirectory: string): string {
  return join(dataDirectory, DATA_LAYOUT_MARKER)
}

export function backupsDirectory(dataDirectory: string): string {
  return join(dataDirectory, 'backups')
}

export function exportsDirectory(dataDirectory: string): string {
  return join(dataDirectory, 'exports')
}
