import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import Database from 'better-sqlite3'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { confirmMatches, hasFlag, parseFlags, readFlag } from './args.js'
import {
  backupDataDirectory,
  clearOwnedEntries,
  createTimestampLabel,
  listOwnedEntries,
  restoreDataDirectoryFromBackup,
} from './backup.js'
import { runCli } from './cli.js'
import {
  doctorRuntime,
  formatDoctorReport,
  resetDoctorRuntime,
  runDoctor,
} from './doctor.js'
import {
  assertNoSymlinkAlongPath,
  assertNoSymlinkAncestors,
  assertPathInside,
  assertResettableDataDirectory,
  assertSafeDataDirectoryInput,
  ensureDataLayout,
  findRepositoryRoot,
  inspectDataDirectory,
  isInsideDirectory,
  posixRelative,
  resolveRequestedDataDirectory,
} from './paths.js'
import {
  PORTABLE_FORMAT,
  PORTABLE_MANIFEST_NAME,
  buildPortableSnapshot,
  exportPortableArchive,
  importPortableArchive,
  previewPortableArchive,
  readPortableArchive,
} from './portable.js'
import {
  assertPortableValueIsSafe,
  hideSecrets,
  hideSecretsInUnknown,
  portableTextLooksUnsafe,
  portableValueLooksUnsafe,
  redactRepositoryUrl,
  stringContainsAbsoluteFilesystemPath,
} from './redact-cli.js'
import { previewReset } from './reset.js'
import { runSetup } from './setup.js'

const tempDirectories: string[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(() => {
  resetDoctorRuntime()
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('distribution args', () => {
  it('parses empty tokens, rest args, equals flags, and bare flags', () => {
    const parsed = parseFlags([
      '',
      'positional',
      '--foo=bar',
      '--name',
      'value',
      '--bool',
      '--',
      'kept',
      '--not-a-flag',
    ])
    expect(parsed.positionals).toEqual(['positional', 'kept', '--not-a-flag'])
    expect(parsed.flags.get('foo')).toBe('bar')
    expect(parsed.flags.get('name')).toBe('value')
    expect(parsed.flags.get('bool')).toBe(true)
    expect(readFlag(parsed.flags, 'name')).toBe('value')
    expect(readFlag(parsed.flags, 'bool')).toBeUndefined()
    expect(readFlag(parsed.flags, 'missing')).toBeUndefined()
    expect(hasFlag(parsed.flags, 'bool')).toBe(true)
    expect(hasFlag(parsed.flags, 'missing')).toBe(false)
    expect(confirmMatches('RESET', 'RESET')).toBe(true)
    expect(confirmMatches(undefined, 'RESET')).toBe(false)
    expect(confirmMatches('reset', 'RESET')).toBe(false)
  })
})

describe('distribution redact-cli', () => {
  it('detects secrets, reasoning keys, file URLs, and absolute paths without rejecting http URLs', () => {
    expect(stringContainsAbsoluteFilesystemPath('https://example.com/x')).toBe(
      false,
    )
    expect(stringContainsAbsoluteFilesystemPath('/opt/secret')).toBe(true)
    expect(stringContainsAbsoluteFilesystemPath('see /srv/data/file')).toBe(
      true,
    )
    expect(stringContainsAbsoluteFilesystemPath('C:\\Windows\\system32')).toBe(
      true,
    )
    expect(stringContainsAbsoluteFilesystemPath('note D:/hidden')).toBe(true)
    expect(stringContainsAbsoluteFilesystemPath('file:///opt/x')).toBe(true)
    expect(stringContainsAbsoluteFilesystemPath('  file:local')).toBe(true)
    expect(stringContainsAbsoluteFilesystemPath('plain text')).toBe(false)
    expect(portableValueLooksUnsafe({ name: 'https://example.com/repo' })).toBe(
      false,
    )
    expect(portableValueLooksUnsafe({ name: '/opt/secret' })).toBe(true)
    expect(portableValueLooksUnsafe({ thinking: 'hidden' })).toBe(true)
    expect(portableValueLooksUnsafe({ chain_of_thought: 'x' })).toBe(true)
    expect(portableValueLooksUnsafe({ chainOfThought: 'x' })).toBe(true)
    expect(portableValueLooksUnsafe({ items: [{ note: '/opt/x' }] })).toBe(true)
    expect(portableValueLooksUnsafe({ token: 'TOKEN=sk-live-secret' })).toBe(
      true,
    )
    expect(portableValueLooksUnsafe(12)).toBe(false)
    expect(portableValueLooksUnsafe(null)).toBe(false)
    const cyclic: Record<string, unknown> = { name: 'ok' }
    cyclic.self = cyclic
    expect(portableValueLooksUnsafe(cyclic)).toBe(true)
    expect(portableTextLooksUnsafe('{"name":"ok"}')).toBe(false)
    expect(portableTextLooksUnsafe('{"reasoning":"nope"}')).toBe(true)
    expect(portableTextLooksUnsafe('not-json /opt/secret')).toBe(true)
    expect(() => assertPortableValueIsSafe({ name: 'ok' })).not.toThrow()
    expect(() => assertPortableValueIsSafe({ reasoning: 'x' })).toThrow(
      /absolute paths|reasoning|secrets/,
    )
    expect(hideSecrets('TOKEN=sk-live-secret file:///opt/x')).toContain(
      '[redacted]',
    )
    expect(hideSecrets('see /opt/hidden')).toContain('[redacted-path]')
    expect(hideSecretsInUnknown('TOKEN=sk-live-secret')).toContain('[redacted]')
    expect(hideSecretsInUnknown(['/opt/x'])).toEqual(['[redacted-path]'])
    expect(hideSecretsInUnknown({ summary: 'ok', reasoning: 'no' })).toEqual({
      summary: 'ok',
    })
    expect(hideSecretsInUnknown(cyclic)).toEqual({})
    expect(hideSecretsInUnknown(7)).toBe(7)
    expect(redactRepositoryUrl(null)).toBeNull()
    expect(redactRepositoryUrl('https://github.com/example/repo.git')).toBe(
      'https://github.com/example/repo.git',
    )
    expect(
      redactRepositoryUrl('https://user:pass@github.com/example/repo.git'),
    ).toBe('https://github.com/example/repo.git')
  })
})

describe('distribution paths', () => {
  it('rejects empty, long, relative, traversal, protected, and repository paths', () => {
    expect(() => assertSafeDataDirectoryInput('')).toThrow(AppError)
    expect(() => assertSafeDataDirectoryInput('   ')).toThrow(AppError)
    expect(() => assertSafeDataDirectoryInput(`/${'a'.repeat(5000)}`)).toThrow(
      AppError,
    )
    expect(() => assertSafeDataDirectoryInput('/tmp/ok\0bad')).toThrow(AppError)
    expect(() => assertSafeDataDirectoryInput('/tmp/foo/../secret')).toThrow(
      AppError,
    )
    expect(() => assertSafeDataDirectoryInput('relative/data')).toThrow(
      AppError,
    )
    expect(() => assertSafeDataDirectoryInput('/')).toThrow(AppError)
    expect(() => assertSafeDataDirectoryInput(homedir())).toThrow(AppError)
    expect(() => assertSafeDataDirectoryInput(tmpdir())).toThrow(AppError)
    expect(() => assertSafeDataDirectoryInput('/etc')).toThrow(AppError)
    const repo = findRepositoryRoot()
    expect(repo).toBeTruthy()
    expect(() => assertSafeDataDirectoryInput(repo!)).toThrow(AppError)
    expect(() => assertSafeDataDirectoryInput(join(repo!, 'docs'))).toThrow(
      AppError,
    )
    expect(
      resolveRequestedDataDirectory({ SIKUMI_LOCAL_DATA_DIR: trackTemp() }),
    ).toBeTruthy()
  })

  it('inspects missing directories and refuses reset of unrecognized or mismatched targets', () => {
    const missing = join(trackTemp(), 'not-created')
    const inspection = inspectDataDirectory(missing)
    expect(inspection.exists).toBe(false)
    expect(inspection.recognized).toBe(false)
    expect(() =>
      assertResettableDataDirectory(missing, {
        SIKUMI_LOCAL_DATA_DIR: missing,
      }),
    ).toThrow(AppError)
    const other = trackTemp()
    const dataDirectory = preparedDataDir()
    expect(() =>
      assertResettableDataDirectory(other, {
        SIKUMI_LOCAL_DATA_DIR: dataDirectory,
      }),
    ).toThrow(AppError)
    const filePath = join(trackTemp(), 'file-dir')
    writeFileSync(filePath, 'x')
    expect(() =>
      assertResettableDataDirectory(filePath, {
        SIKUMI_LOCAL_DATA_DIR: filePath,
      }),
    ).toThrow(AppError)
  })

  it('covers symlink ancestor checks, path containment, and layout refusal of files', () => {
    const real = trackTemp()
    const parent = trackTemp()
    const link = join(parent, 'link')
    symlinkSync(real, link)
    expect(() => assertNoSymlinkAncestors(join(link, 'child'))).toThrow(
      AppError,
    )
    expect(() => assertNoSymlinkAlongPath(link)).toThrow(AppError)
    expect(isInsideDirectory(join(real, 'a'), real)).toBe(true)
    expect(isInsideDirectory(parent, real)).toBe(false)
    expect(posixRelative(real, join(real, 'a', 'b'))).toBe('a/b')
    const inside = join(real, 'nested')
    mkdirSync(inside)
    expect(assertPathInside(inside, real, 'nested')).toBeTruthy()
    expect(() => assertPathInside(parent, real, 'escape')).toThrow(AppError)
    expect(assertPathInside(join(real, 'missing'), real, 'future')).toContain(
      'missing',
    )
    const blocked = trackTemp()
    writeFileSync(join(blocked, 'not-a-dir'), 'x')
    expect(() => ensureDataLayout(join(blocked, 'not-a-dir', 'child'))).toThrow(
      AppError,
    )
    expect(findRepositoryRoot('/')).toBeNull()
  })
})

describe('distribution backup and restore', () => {
  it('backs up owned files, restores them, and skips the backups directory', () => {
    const dataDirectory = preparedDataDir()
    writeFileSync(join(dataDirectory, 'database.sqlite'), 'db-bytes')
    writeFileSync(join(dataDirectory, 'config.json'), '{"ok":true}')
    mkdirSync(join(dataDirectory, 'reports', 'nested'), { recursive: true })
    writeFileSync(join(dataDirectory, 'reports', 'nested', 'note.txt'), 'note')
    const stamp = new Date('2026-01-02T03:04:05.006Z')
    expect(createTimestampLabel(stamp)).toContain('2026-01-02')
    const backup = backupDataDirectory(dataDirectory, 'reset', stamp)
    expect(backup.copied).toContain('database.sqlite')
    expect(backup.copied).not.toContain('backups')
    writeFileSync(join(dataDirectory, 'database.sqlite'), 'changed')
    restoreDataDirectoryFromBackup(dataDirectory, backup.backupDirectory)
    expect(readFileSync(join(dataDirectory, 'database.sqlite'), 'utf8')).toBe(
      'db-bytes',
    )
    expect(listOwnedEntries(join(trackTemp(), 'missing-dir'))).toEqual([])
  })

  it('refuses symlink data dirs, symlink backups, and symlink owned entries', () => {
    const real = preparedDataDir()
    const parent = trackTemp()
    const link = join(parent, 'data-link')
    symlinkSync(real, link)
    expect(() => backupDataDirectory(link, 'import')).toThrow(AppError)
    expect(() => clearOwnedEntries(link)).toThrow(AppError)
    expect(() =>
      restoreDataDirectoryFromBackup(real, join(trackTemp(), 'nope')),
    ).toThrow(AppError)
    const backupLink = join(parent, 'backup-link')
    symlinkSync(trackTemp(), backupLink)
    expect(() => restoreDataDirectoryFromBackup(real, backupLink)).toThrow(
      AppError,
    )
    rmSync(join(real, 'reports'), { recursive: true, force: true })
    symlinkSync(trackTemp(), join(real, 'reports'))
    expect(() => backupDataDirectory(real, 'reset')).toThrow(AppError)
    expect(() => clearOwnedEntries(real)).toThrow(AppError)
  })
})

describe('distribution portable extra branches', () => {
  it('exports an empty snapshot when no database exists and writes a directory archive', () => {
    const dataDirectory = preparedDataDir()
    const snapshot = buildPortableSnapshot(dataDirectory)
    expect(snapshot.workspaces).toEqual([])
    const destDir = join(trackTemp(), 'bundle-dir')
    mkdirSync(destDir)
    const result = exportPortableArchive({
      destination: `${destDir}/`,
      env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    expect(existsSync(join(destDir, 'shikumi-portable.json'))).toBe(true)
    expect(previewPortableArchive(destDir).mode).toBe('preview')
    expect(result.preview.format).toBe(PORTABLE_FORMAT)
  })

  it('rejects empty, relative, missing, invalid, and non-file portable sources', () => {
    const dataDirectory = preparedDataDir()
    expect(() =>
      exportPortableArchive({
        destination: '',
        env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      }),
    ).toThrow(AppError)
    expect(() =>
      exportPortableArchive({
        destination: 'relative.json',
        env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      }),
    ).toThrow(AppError)
    expect(() =>
      exportPortableArchive({
        destination: '/tmp/safe/../secret.json',
        env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      }),
    ).toThrow(AppError)
    expect(() => readPortableArchive('')).toThrow(AppError)
    expect(() => readPortableArchive('relative.json')).toThrow(AppError)
    expect(() =>
      readPortableArchive(join(trackTemp(), 'missing.json')),
    ).toThrow(AppError)
    const invalid = join(trackTemp(), 'invalid.json')
    writeFileSync(invalid, '{')
    expect(() => readPortableArchive(invalid)).toThrow(AppError)
    const badSchema = join(trackTemp(), 'schema.json')
    writeFileSync(badSchema, '{"format":"nope"}\n')
    expect(() => readPortableArchive(badSchema)).toThrow(AppError)
    const emptyDir = trackTemp()
    expect(() => readPortableArchive(emptyDir)).toThrow(AppError)
  })

  it('imports richer snapshots including artifacts, growth, unlocks, and packs', () => {
    const sourceDir = preparedDataDir()
    seedRichHistory(sourceDir)
    const archive = join(trackTemp(), 'rich.json')
    exportPortableArchive({
      destination: archive,
      env: { SIKUMI_LOCAL_DATA_DIR: sourceDir },
    })
    const target = preparedDataDir()
    expect(
      importPortableArchive({
        source: archive,
        confirm: 'IMPORT',
        env: { SIKUMI_LOCAL_DATA_DIR: target },
      }).mode,
    ).toBe('applied')
    expect(
      importPortableArchive({
        source: archive,
        confirm: 'IMPORT',
        env: { SIKUMI_LOCAL_DATA_DIR: target },
      }).mode,
    ).toBe('applied')
    const opened = openTrackedDatabase(target)
    const store = createStore(opened.db)
    expect(store.listArtifacts()).toHaveLength(1)
    expect(store.listGrowthRecords()).toHaveLength(1)
    expect(store.listWorldUnlocks()).toHaveLength(1)
    expect(store.listWorldFeatureUnlocks()).toHaveLength(1)
    expect(store.findPack('world', 'example-garden')).toBeTruthy()
  })
})

describe('distribution doctor', () => {
  it('formats required failures and treats an unsafe data directory as unavailable', async () => {
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: '/' })
    expect(report.dataDirectory).toBe('unavailable')
    expect(report.ok).toBe(false)
    expect(
      report.checks.find((check) => check.label === 'Application Data')?.detail,
    ).toBe('data directory is unsafe')
    const rendered = formatDoctorReport({
      bind: '127.0.0.1',
      dataDirectory: 'unavailable',
      ok: false,
      checks: [
        { label: 'Node.js', status: 'ok', detail: 'v22', required: true },
        { label: 'Git', status: 'fail', detail: 'not found', required: true },
        {
          label: 'Codex installed',
          status: 'warn',
          detail: 'not found',
          required: false,
        },
      ],
    })
    expect(rendered).toContain('× Git')
    expect(rendered).toContain('△ Codex installed')
    expect(rendered).toContain('Required foundation tools are missing.')
  })

  it('reads migration versions and pack counts from an existing database', async () => {
    const dataDirectory = preparedDataDir()
    seedRichHistory(dataDirectory)
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'Database migration')
        ?.detail,
    ).toMatch(/versions/)
    expect(
      report.checks.find((check) => check.label === 'World packs')?.status,
    ).toBe('ok')
    expect(
      Number(
        report.checks.find((check) => check.label === 'Employee packs')?.detail,
      ),
    ).toBeGreaterThanOrEqual(1)
    expect(
      report.checks.find((check) => check.label === 'Employee packs')?.status,
    ).toBe('ok')
    expect(
      report.checks.find((check) => check.label === 'Repository')?.status,
    ).toBe('ok')
  })

  it('warns when the sqlite file exists but has no domain schema', async () => {
    const dataDirectory = preparedDataDir()
    const sqlite = new Database(join(dataDirectory, 'database.sqlite'))
    sqlite.close()
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'Database migration')
        ?.detail,
    ).toBe('schema_migrations not found')
    expect(
      report.checks.find((check) => check.label === 'Repository')?.detail,
    ).toBe('database is not readable')
    expect(
      report.checks.find((check) => check.label === 'Employee packs')?.detail,
    ).toBe('0')
  })

  it('treats missing provider CLIs as warnings and keeps required tools required', async () => {
    const dataDirectory = preparedDataDir()
    doctorRuntime.execFileSync = ((
      command: string,
      args: readonly string[] | undefined,
    ) => {
      const argv = Array.isArray(args) ? args.map(String) : []
      if (
        command === 'pnpm' ||
        (command === 'git' && argv[0] === '--version')
      ) {
        return 'ok\n'
      }
      if (argv.includes('--help')) {
        return 'generic help without expected flags\n'
      }
      throw new Error('missing')
    }) as unknown as typeof doctorRuntime.execFileSync
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'Codex installed')?.status,
    ).toBe('warn')
    expect(
      report.checks.find((check) => check.label === 'Codex protocol')?.detail,
    ).toBe('help missing expected flags')
    expect(report.checks.find((check) => check.label === 'Git')?.status).toBe(
      'ok',
    )
  })

  it('marks protocol help as available when expected flags are present', async () => {
    const dataDirectory = preparedDataDir()
    doctorRuntime.execFileSync = (() =>
      'app-server stdio sandbox stream-json output-format permission-mode allowedTools agent\n') as unknown as typeof doctorRuntime.execFileSync
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'Codex protocol')?.status,
    ).toBe('ok')
    expect(
      report.checks.find((check) => check.label === 'Claude sandbox')?.status,
    ).toBe('ok')
  })

  it('reports a missing child data directory as writable at the parent', async () => {
    const missing = join(trackTemp(), 'child-data')
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: missing })
    expect(
      report.checks.find((check) => check.label === 'Application Data')?.status,
    ).toBe('ok')
    expect(
      report.checks.find((check) => check.label === 'SQLite')?.detail,
    ).toBe('driver ready')
  })

  it('reports Application Data as not writable when access is denied', async () => {
    const dataDirectory = preparedDataDir()
    doctorRuntime.accessSync = (() => {
      throw new Error('denied')
    }) as unknown as typeof doctorRuntime.accessSync
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'Application Data')?.detail,
    ).toBe('not writable')
  })

  it('reports a localhost bind failure without writing data', async () => {
    const dataDirectory = preparedDataDir()
    const fakeServer = {
      once(event: string, listener: (error: Error) => void) {
        if (event === 'error') {
          queueMicrotask(() => listener(new Error('busy')))
        }
        return fakeServer
      },
      listen() {
        return fakeServer
      },
      close(done?: (error?: Error) => void) {
        done?.()
      },
    }
    doctorRuntime.createServer = (() =>
      fakeServer) as unknown as typeof doctorRuntime.createServer
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'localhost port')?.status,
    ).toBe('fail')
  })

  it('fails SQLite when the driver cannot be loaded', async () => {
    const dataDirectory = preparedDataDir()
    doctorRuntime.loadBetterSqlite = () => {
      throw new Error('missing module')
    }
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'SQLite')?.status,
    ).toBe('fail')
    expect(
      report.checks.find((check) => check.label === 'SQLite')?.detail,
    ).toBe('better-sqlite3 is not available')
    expect(report.ok).toBe(false)
  })

  it('treats an unreadable sqlite file as missing optional database checks', async () => {
    const dataDirectory = preparedDataDir()
    writeFileSync(join(dataDirectory, 'database.sqlite'), 'corrupt')
    doctorRuntime.loadBetterSqlite = (() =>
      class {
        constructor() {
          throw new Error('cannot open')
        }
      }) as unknown as typeof doctorRuntime.loadBetterSqlite
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'SQLite')?.detail,
    ).toBe('driver ready, database present')
    expect(
      report.checks.find((check) => check.label === 'Database migration')
        ?.detail,
    ).toBe('no local database yet')
    expect(
      report.checks.find((check) => check.label === 'Repository')?.detail,
    ).toBe('none registered')
  })

  it('warns when migration, repository, and pack tables are empty', async () => {
    const dataDirectory = preparedDataDir()
    const sqlite = new Database(join(dataDirectory, 'database.sqlite'))
    sqlite.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE repositories (display_name TEXT);
      CREATE TABLE installed_packs (kind TEXT);
    `)
    sqlite.close()
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(
      report.checks.find((check) => check.label === 'Database migration')
        ?.detail,
    ).toBe('none applied')
    expect(
      report.checks.find((check) => check.label === 'Repository')?.detail,
    ).toBe('none registered')
    expect(
      report.checks.find((check) => check.label === 'Character packs')?.detail,
    ).toBe('0')
    expect(
      report.checks.find((check) => check.label === 'Character packs')?.status,
    ).toBe('warn')
  })

  it('formats a successful doctor report and treats blank command output as missing', async () => {
    const rendered = formatDoctorReport({
      bind: '127.0.0.1',
      dataDirectory: '[redacted-path]',
      ok: true,
      checks: [
        { label: 'Node.js', status: 'ok', detail: 'v22', required: true },
      ],
    })
    expect(rendered).toContain('✓ Node.js')
    expect(rendered).toContain('Required foundation tools are available.')

    const dataDirectory = preparedDataDir()
    doctorRuntime.execFileSync = ((
      command: string,
      args: readonly string[] | undefined,
    ) => {
      const argv = Array.isArray(args) ? args.map(String) : []
      if (command === 'pnpm' || argv[0] === '--version') {
        return '\n'
      }
      throw new Error('missing')
    }) as unknown as typeof doctorRuntime.execFileSync
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(report.checks.find((check) => check.label === 'pnpm')?.status).toBe(
      'fail',
    )
    expect(
      report.checks.find((check) => check.label === 'Codex protocol')?.detail,
    ).toBe('not found')
    expect(report.ok).toBe(false)
  })
})

describe('distribution cli extra branches', () => {
  it('prints usage, preview, and import argument errors', async () => {
    expect(await runCli(['unknown'])).toBe(1)
    expect(await runCli(['import'])).toBe(1)
    const dataDirectory = preparedDataDir()
    expect(
      await runCli(['export', '--preview'], {
        SIKUMI_LOCAL_DATA_DIR: dataDirectory,
      }),
    ).toBe(0)
    expect(
      await runCli(['doctor'], { SIKUMI_LOCAL_DATA_DIR: dataDirectory }),
    ).toBe(0)
    expect(
      await runCli(['reset'], {
        SIKUMI_LOCAL_DATA_DIR: join(trackTemp(), 'ghost'),
      }),
    ).toBe(0)
  })
})

describe('distribution reset preview of a missing directory', () => {
  it('returns no owned entries when the data directory does not exist yet', () => {
    const missing = join(trackTemp(), 'future')
    const preview = previewReset({ SIKUMI_LOCAL_DATA_DIR: missing })
    expect(preview.ownedEntries).toEqual([])
  })

  it('refuses to preview reset of a symlink data directory', () => {
    const real = preparedDataDir()
    const link = join(trackTemp(), 'data-link')
    symlinkSync(real, link)
    expect(() => previewReset({ SIKUMI_LOCAL_DATA_DIR: link })).toThrow(
      AppError,
    )
  })
})

describe('distribution extra path, backup, and portable branches', () => {
  it('rejects Windows protected basenames and symlink path escapes', () => {
    expect(() => assertSafeDataDirectoryInput('/Windows')).toThrow(AppError)
    expect(() => assertSafeDataDirectoryInput('/Program Files')).toThrow(
      AppError,
    )
    const root = trackTemp()
    const escape = join(root, 'escape')
    symlinkSync(trackTemp(), escape)
    expect(() => assertPathInside(escape, root, 'escape')).toThrow(AppError)
  })

  it('refuses to backup a non-file owned entry', () => {
    const dataDirectory = preparedDataDir()
    execFileSync('mkfifo', [join(dataDirectory, 'reports', 'pipe')])
    expect(() => backupDataDirectory(dataDirectory, 'reset')).toThrow(AppError)
  })

  it('rejects symlink export destinations, missing manifests, and unwritable writes', () => {
    const dataDirectory = preparedDataDir()
    const env = { SIKUMI_LOCAL_DATA_DIR: dataDirectory }
    const destLink = join(trackTemp(), 'out.json')
    symlinkSync(join(trackTemp(), 'target.json'), destLink)
    expect(() => exportPortableArchive({ destination: destLink, env })).toThrow(
      AppError,
    )

    const emptyDir = trackTemp()
    expect(() => readPortableArchive(emptyDir)).toThrow(AppError)
    const manifestLink = join(emptyDir, PORTABLE_MANIFEST_NAME)
    symlinkSync(join(trackTemp(), 'missing.json'), manifestLink)
    expect(() => readPortableArchive(emptyDir)).toThrow(AppError)

    const destDir = trackTemp()
    chmodSync(destDir, 0o500)
    try {
      expect(() =>
        exportPortableArchive({
          destination: join(destDir, 'denied.json'),
          env,
        }),
      ).toThrow()
    } finally {
      chmodSync(destDir, 0o700)
    }
  })
})

function preparedDataDir(): string {
  const dataDirectory = trackTemp()
  runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
  return dataDirectory
}

function seedRichHistory(dataDirectory: string): void {
  const opened = openTrackedDatabase(dataDirectory)
  const store = createStore(opened.db)
  const workspace = store.createWorkspace({
    absolutePath: join(dataDirectory, 'example-repo'),
    displayName: 'example-repo',
    currentBranch: 'main',
    remoteName: 'origin',
    remoteUrl: 'https://github.com/example/repo.git',
    readable: true,
  })
  mkdirSync(join(dataDirectory, 'example-repo'), { recursive: true })
  const employee = store.insertEmployee({
    id: 'emp_rich',
    packId: 'saguru',
    name: 'サグル',
    role: '調査担当',
    defaultProviderId: null,
    createdAt: 't',
    updatedAt: 't',
  })
  store.insertJob({
    id: 'job_rich',
    workspaceId: workspace.id,
    employeeId: employee.id,
    request: '調べて',
    jobType: 'research',
    selectedProvider: 'codex',
    selectedModel: null,
    permissionProfile: 'research',
    status: 'completed',
    providerSessionId: null,
    createdAt: 't',
    startedAt: 't',
    completedAt: 't',
  })
  store.insertArtifact({
    id: 'art_rich',
    jobId: 'job_rich',
    type: 'report',
    title: '結果',
    storagePath: null,
    createdAt: 't',
  })
  store.insertGrowthRecord({
    id: 'gr_rich',
    employeeId: employee.id,
    workspaceId: workspace.id,
    metric: 'research_completed',
    value: 1,
    createdAt: 't',
  })
  store.insertWorldUnlock({
    id: 'wu_rich',
    workspaceId: workspace.id,
    worldPackId: 'dog-office',
    unlockedAt: 't',
  })
  store.insertWorldFeatureUnlock({
    id: 'wfu_rich',
    workspaceId: workspace.id,
    worldPackId: 'dog-office',
    unlockId: 'bookshelf-small',
    unlockedAt: 't',
  })
  store.insertPack({
    id: 'pack_rich',
    kind: 'world',
    packId: 'example-garden',
    version: '1.0.0',
    sourcePath: null,
    sourceKind: 'folder',
    sourceDisplay: 'example-garden',
    commitHash: null,
    builtin: false,
    installedAt: 't',
  })
  store.insertPack({
    id: 'pack_emp',
    kind: 'employee',
    packId: 'example-observer',
    version: '1.0.0',
    sourcePath: null,
    sourceKind: 'folder',
    sourceDisplay: 'example-observer',
    commitHash: null,
    builtin: false,
    installedAt: 't',
  })
}

function openTrackedDatabase(dataDirectory: string) {
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  return opened
}

function trackTemp(): string {
  const directory = createTemporaryDirectory()
  tempDirectories.push(directory)
  return directory
}
