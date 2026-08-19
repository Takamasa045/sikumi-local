import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  assertSafeDataDirectoryInput,
  mkdirSecureRecursive,
} from './lib/data-directory-policy.mjs'

const SUBDIRECTORIES = [
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
]

try {
  const requested =
    process.env.SIKUMI_LOCAL_DATA_DIR ?? join(homedir(), '.shikumi-local')
  const dataDirectory = assertSafeDataDirectoryInput(requested)
  const created = !existsSync(dataDirectory)
  mkdirSecureRecursive(dataDirectory)
  for (const name of SUBDIRECTORIES) {
    mkdirSecureRecursive(join(dataDirectory, name))
  }
  const marker = join(dataDirectory, '.shikumi-local.json')
  if (!existsSync(marker)) {
    writeFileSync(
      marker,
      `${JSON.stringify(
        {
          format: 'shikumi-local-data',
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  }

  console.log('Shikumi Local setup complete')
  console.log(`Data directory: ${dataDirectory}`)
  console.log(
    created ? 'Created a new data directory.' : 'Layout already present.',
  )
  console.log('Next: pnpm start')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
