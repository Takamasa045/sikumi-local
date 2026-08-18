import { existsSync } from 'node:fs'
import { ensureDataLayout, resolveRequestedDataDirectory } from './paths.js'

export interface SetupResult {
  readonly dataDirectory: string
  readonly created: boolean
}

export function runSetup(env: NodeJS.ProcessEnv = process.env): SetupResult {
  const dataDirectory = resolveRequestedDataDirectory(env)
  const created = !existsSync(dataDirectory)
  return {
    dataDirectory: ensureDataLayout(dataDirectory),
    created,
  }
}
