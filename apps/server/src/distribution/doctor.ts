import { accessSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { hideSecrets } from './redact-cli.js'
import { inspectDataDirectory, resolveRequestedDataDirectory } from './paths.js'
import { databaseFilePath } from '../storage/data-directory.js'

type ReadonlySqlite = {
  close: () => void
  prepare: (sql: string) => { all: () => unknown[]; get: () => unknown }
}

type BetterSqliteConstructor = new (
  path: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => ReadonlySqlite

function defaultLoadBetterSqlite(): BetterSqliteConstructor {
  const require = createRequire(
    join(dirname(fileURLToPath(import.meta.url)), '../../package.json'),
  )
  return require('better-sqlite3') as BetterSqliteConstructor
}

export const doctorRuntime = {
  execFileSync,
  accessSync,
  createServer,
  existsSync,
  loadBetterSqlite: defaultLoadBetterSqlite,
}

export function resetDoctorRuntime(): void {
  doctorRuntime.execFileSync = execFileSync
  doctorRuntime.accessSync = accessSync
  doctorRuntime.createServer = createServer
  doctorRuntime.existsSync = existsSync
  doctorRuntime.loadBetterSqlite = defaultLoadBetterSqlite
}

export interface DoctorCheck {
  readonly label: string
  readonly status: 'ok' | 'warn' | 'fail'
  readonly detail: string
  readonly required: boolean
}

export interface DoctorReport {
  readonly bind: '127.0.0.1'
  readonly dataDirectory: string
  readonly checks: readonly DoctorCheck[]
  readonly ok: boolean
}

export async function runDoctor(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DoctorReport> {
  const dataDirectory = safeDataDirectory(env)
  const inspection = dataDirectory
    ? inspectDataDirectory(dataDirectory)
    : undefined
  const writableRoot =
    inspection?.exists && inspection.isDirectory
      ? dataDirectory
      : dataDirectory
        ? dirname(dataDirectory)
        : undefined
  const checks: DoctorCheck[] = [
    requiredTool('Node.js', process.version, true),
    commandCheck('pnpm', ['--version'], true),
    commandCheck('Git', ['--version'], true),
    sqliteCheck(dataDirectory),
    applicationDataCheck(writableRoot),
    await localhostPortCheck(),
    {
      label: 'Bind policy',
      status: 'ok',
      detail: '127.0.0.1 only',
      required: true,
    },
    repositoryCheck(dataDirectory),
    commandCheck('Codex installed', ['--version'], false, 'codex'),
    providerAuthCheck('Codex auth', 'codex', ['login', 'status']),
    protocolHelpCheck(
      'Codex protocol',
      'codex',
      ['app-server', '--help'],
      ['app-server', 'stdio'],
    ),
    commandCheck('Grok Build installed', ['--version'], false, 'grok'),
    providerAuthCheck('Grok auth', 'grok', [
      '--no-auto-update',
      'version',
      '--json',
    ]),
    protocolHelpCheck(
      'Grok protocol',
      'grok',
      ['--no-auto-update', 'agent', 'stdio', '--help'],
      ['agent', 'stdio'],
    ),
    commandCheck('Claude Code installed', ['--version'], false, 'claude'),
    providerAuthCheck('Claude auth', 'claude', ['auth', 'status']),
    protocolHelpCheck(
      'Claude protocol',
      'claude',
      ['--help'],
      ['stream-json', 'output-format'],
    ),
    sandboxHelpCheck('Codex sandbox', 'codex', ['exec', '--help'], ['sandbox']),
    sandboxHelpCheck('Grok sandbox', 'grok', ['--help'], ['sandbox']),
    sandboxHelpCheck(
      'Claude sandbox',
      'claude',
      ['--help'],
      ['permission-mode', 'allowedTools'],
    ),
    commandCheck('Git worktree', ['worktree', '--help'], false, 'git'),
    {
      label: 'SSE',
      status: 'ok',
      detail: 'Last-Event-ID / cursor replay, no reasoning frames',
      required: false,
    },
    migrationCheck(dataDirectory),
    ...installedPackCountChecks(dataDirectory),
  ]

  return {
    bind: '127.0.0.1',
    dataDirectory: dataDirectory ? hideSecrets(dataDirectory) : 'unavailable',
    checks,
    ok: checks.every((check) => !check.required || check.status === 'ok'),
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    'Shikumi Local Doctor',
    `Bind policy: ${report.bind}`,
    `Data directory: ${report.dataDirectory}`,
    'Read-only. Secrets, tokens, and absolute paths are hidden.',
    '',
  ]
  for (const check of report.checks) {
    const mark =
      check.status === 'ok'
        ? '✓'
        : check.status === 'fail' && check.required
          ? '×'
          : '△'
    lines.push(`${mark} ${check.label}: ${check.detail}`)
  }
  lines.push('')
  lines.push(
    report.ok
      ? 'Required foundation tools are available.'
      : 'Required foundation tools are missing.',
  )
  return lines.join('\n')
}

function safeDataDirectory(env: NodeJS.ProcessEnv): string | undefined {
  try {
    return resolveRequestedDataDirectory(env)
  } catch {
    return undefined
  }
}

function requiredTool(
  label: string,
  value: string | null,
  required: boolean,
): DoctorCheck {
  return {
    label,
    status: value ? 'ok' : required ? 'fail' : 'warn',
    detail: value ? hideSecrets(value) : 'not found',
    required,
  }
}

function commandCheck(
  label: string,
  args: readonly string[],
  required: boolean,
  command = inferCommand(label),
): DoctorCheck {
  const version = readCommand(command, args)
  return requiredTool(label, version, required)
}

function inferCommand(label: string): string {
  if (label.startsWith('Git')) {
    return 'git'
  }
  if (label.startsWith('Grok')) {
    return 'grok'
  }
  if (label.startsWith('Claude')) {
    return 'claude'
  }
  if (label.startsWith('Codex')) {
    return 'codex'
  }
  return label.toLowerCase()
}

function readCommand(command: string, args: readonly string[]): string | null {
  try {
    return hideSecrets(
      doctorRuntime
        .execFileSync(command, [...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 4_000,
        })
        .trim()
        .split('\n')[0] ?? '',
    )
  } catch {
    return null
  }
}

function readCommandFull(
  command: string,
  args: readonly string[],
): string | null {
  try {
    return doctorRuntime.execFileSync(command, [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4_000,
    })
  } catch {
    return null
  }
}

function applicationDataCheck(directory: string | undefined): DoctorCheck {
  if (!directory) {
    return {
      label: 'Application Data',
      status: 'fail',
      detail: 'data directory is unsafe',
      required: true,
    }
  }
  try {
    doctorRuntime.accessSync(directory, constants.R_OK | constants.W_OK)
    return {
      label: 'Application Data',
      status: 'ok',
      detail: 'writable',
      required: true,
    }
  } catch {
    return {
      label: 'Application Data',
      status: 'fail',
      detail: 'not writable',
      required: true,
    }
  }
}

async function localhostPortCheck(): Promise<DoctorCheck> {
  const server = doctorRuntime.createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    return {
      label: 'localhost port',
      status: 'ok',
      detail: '127.0.0.1 bind succeeded',
      required: true,
    }
  } catch {
    return {
      label: 'localhost port',
      status: 'fail',
      detail: 'could not bind 127.0.0.1',
      required: true,
    }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }
}

function sqliteCheck(dataDirectory: string | undefined): DoctorCheck {
  try {
    doctorRuntime.loadBetterSqlite()
    const dbPath = dataDirectory ? databaseFilePath(dataDirectory) : ''
    return {
      label: 'SQLite',
      status: 'ok',
      detail:
        dbPath && doctorRuntime.existsSync(dbPath)
          ? 'driver ready, database present'
          : 'driver ready',
      required: true,
    }
  } catch {
    return {
      label: 'SQLite',
      status: 'fail',
      detail: 'better-sqlite3 is not available',
      required: true,
    }
  }
}

function openReadonlyDatabase(dataDirectory: string | undefined): {
  close: () => void
  prepare: (sql: string) => { all: () => unknown[]; get: () => unknown }
} | null {
  if (!dataDirectory) {
    return null
  }
  const dbPath = databaseFilePath(dataDirectory)
  if (!doctorRuntime.existsSync(dbPath)) {
    return null
  }
  try {
    const Database = doctorRuntime.loadBetterSqlite()
    return new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}

function repositoryCheck(dataDirectory: string | undefined): DoctorCheck {
  const sqlite = openReadonlyDatabase(dataDirectory)
  if (!sqlite) {
    return {
      label: 'Repository',
      status: 'warn',
      detail: 'none registered',
      required: false,
    }
  }
  try {
    const rows = sqlite
      .prepare('SELECT display_name FROM repositories')
      .all() as Array<{ display_name: string }>
    const names = rows.map((row) => hideSecrets(row.display_name)).join(', ')
    return {
      label: 'Repository',
      status: rows.length === 0 ? 'warn' : 'ok',
      detail:
        rows.length === 0
          ? 'none registered'
          : `${rows.length} registered (${names})`,
      required: false,
    }
  } catch {
    return {
      label: 'Repository',
      status: 'warn',
      detail: 'database is not readable',
      required: false,
    }
  } finally {
    sqlite.close()
  }
}

function providerAuthCheck(
  label: string,
  command: string,
  args: readonly string[],
): DoctorCheck {
  const output = readCommand(command, args)
  return {
    label,
    status: output ? 'ok' : 'warn',
    detail: output ?? 'not found',
    required: false,
  }
}

function protocolHelpCheck(
  label: string,
  command: string,
  args: readonly string[],
  needles: readonly string[],
): DoctorCheck {
  const output = readCommandFull(command, args)
  if (!output) {
    return { label, status: 'warn', detail: 'not found', required: false }
  }
  const lower = output.toLowerCase()
  const matched = needles.some((needle) => lower.includes(needle.toLowerCase()))
  return {
    label,
    status: matched ? 'ok' : 'warn',
    detail: matched ? 'help available' : 'help missing expected flags',
    required: false,
  }
}

function sandboxHelpCheck(
  label: string,
  command: string,
  args: readonly string[],
  needles: readonly string[],
): DoctorCheck {
  return protocolHelpCheck(label, command, args, needles)
}

function migrationCheck(dataDirectory: string | undefined): DoctorCheck {
  const sqlite = openReadonlyDatabase(dataDirectory)
  if (!sqlite) {
    return {
      label: 'Database migration',
      status: 'warn',
      detail: 'no local database yet',
      required: false,
    }
  }
  try {
    const rows = sqlite
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>
    const versions = rows.map((row) => row.version).join(', ')
    return {
      label: 'Database migration',
      status: rows.length === 0 ? 'warn' : 'ok',
      detail: rows.length === 0 ? 'none applied' : `versions ${versions}`,
      required: false,
    }
  } catch {
    return {
      label: 'Database migration',
      status: 'warn',
      detail: 'schema_migrations not found',
      required: false,
    }
  } finally {
    sqlite.close()
  }
}

function installedPackCountChecks(
  dataDirectory: string | undefined,
): DoctorCheck[] {
  const empty = (label: string): DoctorCheck => ({
    label,
    status: 'warn',
    detail: '0',
    required: false,
  })
  const sqlite = openReadonlyDatabase(dataDirectory)
  if (!sqlite) {
    return [
      empty('Employee packs'),
      empty('Character packs'),
      empty('World packs'),
    ]
  }
  try {
    const rows = sqlite
      .prepare(
        'SELECT kind, COUNT(*) AS count FROM installed_packs GROUP BY kind',
      )
      .all() as Array<{ kind: string; count: number }>
    const counts = new Map(rows.map((row) => [row.kind, row.count]))
    return [
      packCount('Employee packs', counts.get('employee') ?? 0),
      packCount('Character packs', counts.get('character') ?? 0),
      packCount('World packs', counts.get('world') ?? 0),
    ]
  } catch {
    return [
      empty('Employee packs'),
      empty('Character packs'),
      empty('World packs'),
    ]
  } finally {
    sqlite.close()
  }
}

function packCount(label: string, count: number): DoctorCheck {
  return {
    label,
    status: count > 0 ? 'ok' : 'warn',
    detail: String(count),
    required: false,
  }
}
