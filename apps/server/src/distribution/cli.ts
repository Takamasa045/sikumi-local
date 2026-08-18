import { join } from 'node:path'
import { isAppError } from '@sikumi-local/core'
import { exportsDirectory } from '../storage/data-directory.js'
import {
  hasFlag,
  IMPORT_CONFIRM_TOKEN,
  parseFlags,
  readFlag,
  RESET_CONFIRM_TOKEN,
} from './args.js'
import { formatDoctorReport, runDoctor } from './doctor.js'
import {
  buildPortableSnapshot,
  exportPortableArchive,
  importPortableArchive,
  previewPortableArchive,
  previewPortableSnapshot,
  type PortablePreview,
} from './portable.js'
import { portableValueLooksUnsafe } from './redact-cli.js'
import { resolveRequestedDataDirectory } from './paths.js'
import { applyReset, previewReset } from './reset.js'
import { runSetup } from './setup.js'

export async function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const command = argv[0]
  const rest = argv.slice(1)
  try {
    switch (command) {
      case 'setup':
        return runSetupCommand(env)
      case 'doctor':
        return await runDoctorCommand(env)
      case 'reset':
        return runResetCommand(rest, env)
      case 'export':
        return runExportCommand(rest, env)
      case 'import':
        return runImportCommand(rest, env)
      default:
        console.error(
          'Usage: pnpm setup | pnpm doctor | pnpm data:reset [--confirm RESET] | pnpm data:export [--out <abs>] [--preview] [--overwrite] | pnpm data:import --from <abs> [--confirm IMPORT]',
        )
        return 1
    }
  } catch (error) {
    if (isAppError(error)) {
      console.error(`${error.code}: ${error.message}`)
      return 1
    }
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

function runSetupCommand(env: NodeJS.ProcessEnv): number {
  const result = runSetup(env)
  console.log('Shikumi Local setup complete')
  console.log(`Data directory: ${result.dataDirectory}`)
  console.log(
    result.created
      ? 'Created a new data directory.'
      : 'Layout already present.',
  )
  console.log('Next: pnpm start')
  return 0
}

async function runDoctorCommand(env: NodeJS.ProcessEnv): Promise<number> {
  const report = await runDoctor(env)
  console.log(formatDoctorReport(report))
  return report.ok ? 0 : 1
}

function runResetCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): number {
  const { flags } = parseFlags(argv)
  if (hasFlag(flags, 'confirm')) {
    const result = applyReset(readFlag(flags, 'confirm'), env)
    console.log('Shikumi Local reset complete')
    console.log(`Data directory: ${result.dataDirectory}`)
    console.log(`Backup: ${result.backup.backupDirectory}`)
    return 0
  }
  const preview = previewReset(env)
  console.log('Shikumi Local reset preview')
  console.log(`Data directory: ${preview.dataDirectory}`)
  console.log(`Owned entries: ${preview.ownedEntries.join(', ') || '(none)'}`)
  console.log(
    `No files were changed. Re-run with --confirm ${RESET_CONFIRM_TOKEN} to reset.`,
  )
  return 0
}

function runExportCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): number {
  const { flags } = parseFlags(argv)
  const dataDirectory = resolveRequestedDataDirectory(env)
  if (hasFlag(flags, 'preview') && !hasFlag(flags, 'out')) {
    const snapshot = buildPortableSnapshot(dataDirectory)
    if (portableValueLooksUnsafe(snapshot)) {
      throw new Error(
        'Portable archive contains secrets, reasoning, or absolute paths',
      )
    }
    const preview = previewPortableSnapshot(
      snapshot,
      Buffer.byteLength(`${JSON.stringify(snapshot, null, 2)}\n`),
    )
    printPreview('export', preview)
    return 0
  }
  const destination =
    readFlag(flags, 'out') ??
    join(
      exportsDirectory(dataDirectory),
      `shikumi-local-${new Date().toISOString().replaceAll(':', '')}.json`,
    )
  const result = exportPortableArchive({
    destination,
    overwrite: hasFlag(flags, 'overwrite'),
    env,
  })
  console.log('Shikumi Local export complete')
  console.log(`Archive: ${result.destination}`)
  printPreview('export', result.preview)
  return 0
}

function runImportCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): number {
  const { flags } = parseFlags(argv)
  const source = readFlag(flags, 'from')
  if (!source) {
    console.error(
      'Usage: pnpm data:import --from <absolute-path> [--confirm IMPORT]',
    )
    return 1
  }
  if (hasFlag(flags, 'confirm')) {
    const result = importPortableArchive({
      source,
      confirm: readFlag(flags, 'confirm'),
      env,
    })
    console.log('Shikumi Local import complete')
    console.log(`Data directory: ${result.dataDirectory}`)
    console.log(`Backup: ${result.backup.backupDirectory}`)
    printPreview('import', result.preview)
    return 0
  }
  const preview = previewPortableArchive(source)
  printPreview('import', preview.preview)
  console.log(
    `No files were changed. Re-run with --confirm ${IMPORT_CONFIRM_TOKEN} to import.`,
  )
  return 0
}

function printPreview(label: string, preview: PortablePreview): void {
  console.log(
    `${label} schema v${preview.schemaVersion}: ${preview.workspaces} workspaces, ${preview.employees} employees, ${preview.jobs} jobs, ${preview.events} events, ${preview.bytes} bytes`,
  )
}

const invokedDirectly =
  process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')

if (invokedDirectly) {
  process.exitCode = await runCli(process.argv.slice(2))
}
