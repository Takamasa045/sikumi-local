import { AppError } from '@sikumi-local/core'
import { RESET_CONFIRM_TOKEN, confirmMatches } from './args.js'
import {
  backupDataDirectory,
  clearOwnedEntries,
  listOwnedEntries,
  type DirectoryBackupResult,
} from './backup.js'
import {
  assertResettableDataDirectory,
  ensureDataLayout,
  inspectDataDirectory,
  resolveRequestedDataDirectory,
} from './paths.js'
import { runSetup } from './setup.js'

export interface ResetPreview {
  readonly mode: 'preview'
  readonly dataDirectory: string
  readonly ownedEntries: readonly string[]
  readonly confirmToken: typeof RESET_CONFIRM_TOKEN
}

export interface ResetResult {
  readonly mode: 'applied'
  readonly dataDirectory: string
  readonly backup: DirectoryBackupResult
}

export function previewReset(
  env: NodeJS.ProcessEnv = process.env,
): ResetPreview {
  const dataDirectory = resolveRequestedDataDirectory(env)
  const inspection = inspectDataDirectory(dataDirectory)
  if (inspection.isSymlink) {
    throw new AppError(
      'RESET_REFUSED',
      'Refusing to reset a data directory that is a symlink',
      400,
    )
  }
  const ownedEntries = inspection.exists ? listOwnedEntries(dataDirectory) : []
  return {
    mode: 'preview',
    dataDirectory,
    ownedEntries,
    confirmToken: RESET_CONFIRM_TOKEN,
  }
}

export function applyReset(
  confirm: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResetResult {
  if (!confirmMatches(confirm, RESET_CONFIRM_TOKEN)) {
    throw new AppError(
      'RESET_REFUSED',
      `Reset requires --confirm ${RESET_CONFIRM_TOKEN}`,
      400,
    )
  }
  const dataDirectory = assertResettableDataDirectory(
    resolveRequestedDataDirectory(env),
    env,
  )
  const backup = backupDataDirectory(dataDirectory, 'reset')
  clearOwnedEntries(dataDirectory, { keepBackups: true })
  ensureDataLayout(dataDirectory)
  runSetup(env)
  return {
    mode: 'applied',
    dataDirectory,
    backup,
  }
}
