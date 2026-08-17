import { homedir } from 'node:os'
import { join } from 'node:path'

export function resolveDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.SIKUMI_LOCAL_DATA_DIR ?? join(homedir(), '.shikumi-local')
}

export function databaseFilePath(dataDirectory: string): string {
  return join(dataDirectory, 'database.sqlite')
}
