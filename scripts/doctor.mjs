import { accessSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSafeDataDirectoryInput } from './lib/data-directory-policy.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const SECRET = /(?:sk-|xai-|Bearer\s+)[A-Za-z0-9._\-/=]+/gi
const FILE_URL = /\bfile:\/\/[^\s"'`]+/gi
const NON_FILE_URL = /\b(?!file:)[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/gi

function hide(value) {
  return String(value)
    .replace(SECRET, '[redacted]')
    .replace(FILE_URL, '[redacted-path]')
    .replace(NON_FILE_URL, '[redacted-url]')
    .replace(/(^|[\s"'`=])(\/(?!\/)[^\s"'`]+)/g, '$1[redacted-path]')
    .replace(/(^|[\s"'`=])([A-Za-z]:[\\/][^\s"'`]+)/g, '$1[redacted-path]')
}

function command(bin, args = ['--version']) {
  try {
    return hide(
      execFileSync(bin, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 4_000,
      })
        .trim()
        .split('\n')[0],
    )
  } catch {
    return null
  }
}

function commandFull(bin, args) {
  try {
    return execFileSync(bin, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4_000,
    })
  } catch {
    return null
  }
}

function helpAvailable(bin, args, needles) {
  const output = commandFull(bin, args)
  if (!output) {
    return null
  }
  const lower = output.toLowerCase()
  return needles.some((needle) => lower.includes(needle.toLowerCase()))
    ? 'help available'
    : 'help missing expected flags'
}

function sqliteReady(dataDirectory) {
  try {
    const require = createRequire(join(root, 'apps/server/package.json'))
    require('better-sqlite3')
    return dataDirectory && existsSync(join(dataDirectory, 'database.sqlite'))
      ? 'driver ready, database present'
      : 'driver ready'
  } catch {
    return null
  }
}

function canWrite(directory) {
  try {
    accessSync(directory, constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

function openReadonly(dataDirectory) {
  if (!dataDirectory || !existsSync(join(dataDirectory, 'database.sqlite'))) {
    return null
  }
  try {
    const require = createRequire(join(root, 'apps/server/package.json'))
    const Database = require('better-sqlite3')
    return new Database(join(dataDirectory, 'database.sqlite'), {
      readonly: true,
      fileMustExist: true,
    })
  } catch {
    return null
  }
}

async function canBindLocalhost() {
  const server = createServer()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve(undefined))
    })
    return true
  } catch {
    return false
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)))
  }
}

let dataDirectory
try {
  dataDirectory = assertSafeDataDirectoryInput(
    process.env.SIKUMI_LOCAL_DATA_DIR ?? join(homedir(), '.shikumi-local'),
  )
} catch {
  dataDirectory = null
}

const sqlite = openReadonly(dataDirectory)
let repositoryDetail = 'none registered'
let migrationDetail = 'no local database yet'
let employeePacks = '0'
let characterPacks = '0'
let worldPacks = '0'
if (sqlite) {
  try {
    const rows = sqlite.prepare('SELECT display_name FROM repositories').all()
    repositoryDetail =
      rows.length === 0
        ? 'none registered'
        : `${rows.length} registered (${rows.map((row) => hide(row.display_name)).join(', ')})`
  } catch {
    repositoryDetail = 'database is not readable'
  }
  try {
    const versions = sqlite
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.version)
    migrationDetail =
      versions.length === 0 ? 'none applied' : `versions ${versions.join(', ')}`
  } catch {
    migrationDetail = 'schema_migrations not found'
  }
  try {
    const counts = sqlite
      .prepare(
        'SELECT kind, COUNT(*) AS count FROM installed_packs GROUP BY kind',
      )
      .all()
    const map = new Map(counts.map((row) => [row.kind, row.count]))
    employeePacks = String(map.get('employee') ?? 0)
    characterPacks = String(map.get('character') ?? 0)
    worldPacks = String(map.get('world') ?? 0)
  } catch {
    // leave zeros
  }
  sqlite.close()
}

const writableRoot =
  dataDirectory && existsSync(dataDirectory)
    ? dataDirectory
    : dataDirectory
      ? dirname(dataDirectory)
      : null

const checks = [
  ['Node.js', process.version, true],
  ['pnpm', command('pnpm'), true],
  ['Git', command('git'), true],
  ['SQLite', sqliteReady(dataDirectory), true],
  [
    'Application Data',
    writableRoot && canWrite(writableRoot) ? 'writable' : null,
    true,
  ],
  [
    'localhost port',
    (await canBindLocalhost()) ? '127.0.0.1 bind succeeded' : null,
    true,
  ],
  ['Bind policy', '127.0.0.1 only', true],
  [
    'Repository',
    repositoryDetail === 'none registered' ? null : repositoryDetail,
    false,
  ],
  ['Codex installed', command('codex'), false],
  ['Codex auth', command('codex', ['login', 'status']), false],
  [
    'Codex protocol',
    helpAvailable('codex', ['app-server', '--help'], ['app-server', 'stdio']),
    false,
  ],
  ['Grok Build installed', command('grok'), false],
  [
    'Grok auth',
    command('grok', ['--no-auto-update', 'version', '--json']),
    false,
  ],
  [
    'Grok protocol',
    helpAvailable(
      'grok',
      ['--no-auto-update', 'agent', 'stdio', '--help'],
      ['agent', 'stdio'],
    ),
    false,
  ],
  ['Claude Code installed', command('claude'), false],
  ['Claude auth', command('claude', ['auth', 'status']), false],
  [
    'Claude protocol',
    helpAvailable('claude', ['--help'], ['stream-json', 'output-format']),
    false,
  ],
  [
    'Codex sandbox',
    helpAvailable('codex', ['exec', '--help'], ['sandbox']),
    false,
  ],
  ['Grok sandbox', helpAvailable('grok', ['--help'], ['sandbox']), false],
  [
    'Claude sandbox',
    helpAvailable('claude', ['--help'], ['permission-mode', 'allowedTools']),
    false,
  ],
  ['Git worktree', command('git', ['worktree', '--help']), false],
  ['SSE', 'Last-Event-ID / cursor replay, no reasoning frames', false],
  [
    'Database migration',
    migrationDetail === 'no local database yet' ? null : migrationDetail,
    false,
  ],
  ['Employee packs', employeePacks, false],
  ['Character packs', characterPacks, false],
  ['World packs', worldPacks, false],
]

console.log('Shikumi Local Doctor')
console.log('Bind policy: 127.0.0.1')
console.log(
  `Data directory: ${dataDirectory ? hide(dataDirectory) : 'unavailable'}`,
)
console.log('Read-only. Secrets, tokens, and absolute paths are hidden.')
console.log('')

let requiredMissing = false
for (const [label, value, required] of checks) {
  const warnZero = String(label).endsWith('packs') && value === '0'
  const ok = value !== null && !warnZero
  console.log(
    `${ok ? '✓' : required ? '×' : '△'} ${label}: ${value ?? 'not found'}`,
  )
  if (required && value === null) requiredMissing = true
}

if (requiredMissing) {
  console.log('')
  console.log('Required foundation tools are missing.')
  process.exitCode = 1
} else {
  console.log('')
  console.log('Required foundation tools are available.')
}
