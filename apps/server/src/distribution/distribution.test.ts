import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import { loadEmployeePack } from '@sikumi-local/employee-sdk'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import {
  RESET_CONFIRM_TOKEN,
  IMPORT_CONFIRM_TOKEN,
  parseFlags,
} from './args.js'
import { runCli } from './cli.js'
import { runDoctor } from './doctor.js'
import {
  MAX_PORTABLE_BYTES,
  PORTABLE_FORMAT,
  PORTABLE_INCLUDES_OBSERVER_HISTORY,
  exportPortableArchive,
  importPortableArchive,
  previewPortableArchive,
  readPortableArchive,
} from './portable.js'
import {
  portableValueLooksUnsafe,
  stringContainsAbsoluteFilesystemPath,
} from './redact-cli.js'
import {
  assertResettableDataDirectory,
  assertSafeDataDirectoryInput,
  ensureDataLayout,
  findRepositoryRoot,
  inspectDataDirectory,
} from './paths.js'
import { applyReset, previewReset } from './reset.js'
import { runSetup } from './setup.js'

const tempDirectories: string[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(() => {
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('distribution setup', () => {
  it('runs the standalone setup script against temp data', () => {
    const dataDirectory = trackTemp()
    const repoRoot = findRepositoryRoot()
    expect(repoRoot).toBeTruthy()
    const result = spawnSync(
      process.execPath,
      [join(repoRoot!, 'scripts/setup.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('setup complete')
    expect(existsSync(join(dataDirectory, '.shikumi-local.json'))).toBe(true)
  })

  it('is idempotent and creates a permission-safe layout', () => {
    const dataDirectory = trackTemp()
    const first = runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    const second = runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(first.dataDirectory).toBe(realpathSync(dataDirectory))
    expect(second.created).toBe(false)
    expect(existsSync(join(dataDirectory, '.shikumi-local.json'))).toBe(true)
    expect(existsSync(join(dataDirectory, 'backups'))).toBe(true)
    expect(existsSync(join(dataDirectory, 'exports'))).toBe(true)
  })

  it('refuses a data directory that is a symlink', () => {
    const real = trackTemp()
    const parent = trackTemp()
    const link = join(parent, 'linked-data')
    symlinkSync(real, link)
    expect(() => runSetup({ SIKUMI_LOCAL_DATA_DIR: link })).toThrow(AppError)
  })

  it('standalone setup refuses protected, repo, and symlink-ancestor paths', () => {
    const repoRoot = findRepositoryRoot()
    expect(repoRoot).toBeTruthy()
    const setup = join(repoRoot!, 'scripts/setup.mjs')
    const denied = [
      '/',
      process.env.HOME ?? '',
      '/etc',
      repoRoot!,
      join(repoRoot!, 'docs'),
    ].filter((value) => value.length > 0)
    for (const dataDirectory of denied) {
      const result = spawnSync(process.execPath, [setup], {
        encoding: 'utf8',
        env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      })
      expect(result.status !== 0).toBe(true)
    }

    const real = trackTemp()
    const parent = trackTemp()
    const ancestorLink = join(parent, 'link')
    symlinkSync(real, ancestorLink)
    const throughAncestor = join(ancestorLink, 'child')
    const ancestorResult = spawnSync(process.execPath, [setup], {
      encoding: 'utf8',
      env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: throughAncestor },
    })
    expect(ancestorResult.status).not.toBe(0)

    const dataDirectory = preparedDataDir()
    rmSync(join(dataDirectory, 'backups'), { recursive: true, force: true })
    symlinkSync(trackTemp(), join(dataDirectory, 'backups'))
    expect(() => runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })).toThrow(
      AppError,
    )
  })
})

describe('distribution reset', () => {
  it('previews by default and requires an exact confirm token', () => {
    const dataDirectory = preparedDataDir()
    writeFileSync(join(dataDirectory, 'database.sqlite'), 'keep-me')
    const preview = previewReset({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(preview.mode).toBe('preview')
    expect(preview.ownedEntries).toContain('database.sqlite')
    expect(existsSync(join(dataDirectory, 'database.sqlite'))).toBe(true)
    expect(() =>
      applyReset('reset', { SIKUMI_LOCAL_DATA_DIR: dataDirectory }),
    ).toThrow(AppError)
    expect(existsSync(join(dataDirectory, 'database.sqlite'))).toBe(true)
  })

  it('backs up then resets only owned entries after exact confirm', () => {
    const dataDirectory = preparedDataDir()
    writeFileSync(join(dataDirectory, 'database.sqlite'), 'user-data')
    writeFileSync(join(dataDirectory, 'stray.txt'), 'leave-me')
    const result = applyReset(RESET_CONFIRM_TOKEN, {
      SIKUMI_LOCAL_DATA_DIR: dataDirectory,
    })
    expect(result.mode).toBe('applied')
    expect(
      existsSync(join(result.backup.backupDirectory, 'database.sqlite')),
    ).toBe(true)
    expect(readFileSync(join(dataDirectory, 'stray.txt'), 'utf8')).toBe(
      'leave-me',
    )
    expect(existsSync(join(dataDirectory, '.shikumi-local.json'))).toBe(true)
    expect(existsSync(join(dataDirectory, 'database.sqlite'))).toBe(false)
  })

  it('refuses to reset a symlink data directory', () => {
    const real = preparedDataDir()
    writeFileSync(join(real, 'database.sqlite'), 'x')
    const parent = trackTemp()
    const link = join(parent, 'data-link')
    symlinkSync(real, link)
    expect(() =>
      assertResettableDataDirectory(link, { SIKUMI_LOCAL_DATA_DIR: link }),
    ).toThrow(AppError)
    expect(inspectDataDirectory(link).isSymlink).toBe(true)
  })
})

describe('distribution portable export/import', () => {
  it('exports a versioned archive without secrets, reasoning, or absolute paths', () => {
    const dataDirectory = preparedDataDir()
    seedHistory(dataDirectory)
    const destination = join(trackTemp(), 'archive.json')
    const result = exportPortableArchive({
      destination,
      env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    const raw = readFileSync(destination, 'utf8')
    expect(result.preview.format).toBe(PORTABLE_FORMAT)
    expect(result.preview.schemaVersion).toBe(1)
    expect(raw).not.toContain('reasoning')
    expect(raw).not.toContain('sk-live-secret')
    expect(raw).not.toContain('/Users/')
    expect(raw).not.toContain(dataDirectory)
    expect(raw).not.toContain('absolutePath')
    expect(JSON.parse(raw).workspaces[0].repository.displayName).toBe(
      'example-repo',
    )
  })

  it('excludes observer history so hook secrets and absolute paths stay local', () => {
    expect(PORTABLE_INCLUDES_OBSERVER_HISTORY).toBe(false)
    const dataDirectory = preparedDataDir()
    seedHistory(dataDirectory)
    const opened = openTrackedDatabase(dataDirectory)
    const store = createStore(opened.db)
    store.insertObserverEvent(
      {
        id: 'obs_export',
        schemaVersion: 1,
        occurredAt: '2026-08-18T00:00:00.000Z',
        receivedAt: '2026-08-18T00:00:00.000Z',
        source: 'codex',
        surface: 'cli',
        nativeEventType: 'SessionStart',
        normalizedType: 'session.started',
        externalSessionId: 'sess_export',
        externalTurnId: 'turn_export',
        externalTaskId: null,
        externalSubagentId: null,
        cwd: '/Users/example/secret-repo',
        repositoryId: null,
        worktreePath: '/Users/example/secret-repo',
        branch: 'main',
        baseCommit: 'aaa',
        headCommit: 'bbb',
        actorKind: 'agent',
        activity: 'starting',
        resource: null,
        summary: '開始',
        attributionConfidence: 'verified',
        ingestionMethod: 'hook',
        idempotencyKey: 'export-observer-key-12345678',
        payload: {},
      },
      { sessionId: null },
    )
    const destination = join(trackTemp(), 'observer-archive.json')
    exportPortableArchive({
      destination,
      env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    const raw = readFileSync(destination, 'utf8')
    expect(raw).not.toContain('obs_export')
    expect(raw).not.toContain('sess_export')
    expect(raw).not.toContain('/Users/example/secret-repo')
    expect(raw).not.toContain('observer_events')
    expect(raw).not.toContain('externalSessionId')
    expect(raw).not.toContain('reasoning')
  })

  it('previews import and requires the exact confirm token', () => {
    const sourceDir = preparedDataDir()
    seedHistory(sourceDir)
    const archive = join(trackTemp(), 'portable.json')
    exportPortableArchive({
      destination: archive,
      env: { SIKUMI_LOCAL_DATA_DIR: sourceDir },
    })
    const target = preparedDataDir()
    const preview = previewPortableArchive(archive)
    expect(preview.mode).toBe('preview')
    expect(preview.confirmToken).toBe(IMPORT_CONFIRM_TOKEN)
    expect(() =>
      importPortableArchive({
        source: archive,
        confirm: 'import',
        env: { SIKUMI_LOCAL_DATA_DIR: target },
      }),
    ).toThrow(AppError)
  })

  it('imports atomically after backup and restores history without absolute paths', () => {
    const sourceDir = preparedDataDir()
    seedHistory(sourceDir)
    const archive = join(trackTemp(), 'bundle')
    mkdirSync(archive)
    exportPortableArchive({
      destination: archive,
      env: { SIKUMI_LOCAL_DATA_DIR: sourceDir },
    })
    const target = preparedDataDir()
    writeFileSync(join(target, 'database.sqlite'), 'old-bytes')
    const imported = importPortableArchive({
      source: archive,
      confirm: IMPORT_CONFIRM_TOKEN,
      env: { SIKUMI_LOCAL_DATA_DIR: target },
    })
    expect(imported.mode).toBe('applied')
    expect(
      existsSync(join(imported.backup.backupDirectory, 'database.sqlite')),
    ).toBe(true)
    const opened = openTrackedDatabase(target)
    const store = createStore(opened.db)
    const workspace = store.listWorkspaces()[0]
    expect(workspace?.name).toBe('example-repo')
    expect(workspace?.repository.absolutePath.startsWith('unlinked:')).toBe(
      true,
    )
    expect(store.listJobs()).toHaveLength(1)
    expect(store.listAllEvents()[0]?.payload).not.toHaveProperty('reasoning')
  })

  it('refuses to export secrets, reasoning keys, or absolute paths in any field', () => {
    expect(
      portableValueLooksUnsafe({ name: 'https://github.com/example/repo' }),
    ).toBe(false)
    expect(stringContainsAbsoluteFilesystemPath('https://example.com/x')).toBe(
      false,
    )
    expect(portableValueLooksUnsafe({ name: '/opt/secret' })).toBe(true)
    expect(
      portableValueLooksUnsafe({ note: 'see C:\\Windows\\system32' }),
    ).toBe(true)
    expect(portableValueLooksUnsafe({ reasoning: 'hidden' })).toBe(true)
    expect(portableValueLooksUnsafe({ token: 'TOKEN=sk-live-secret' })).toBe(
      true,
    )

    const dataDirectory = preparedDataDir()
    seedHistory(dataDirectory)
    const opened = openTrackedDatabase(dataDirectory)
    createStore(opened.db).insertEmployee({
      id: 'emp_path',
      packId: 'leaky',
      name: '/opt/secret-employee',
      role: '調査担当',
      defaultProviderId: null,
      createdAt: 't',
      updatedAt: 't',
    })
    expect(() =>
      exportPortableArchive({
        destination: join(trackTemp(), 'denied.json'),
        env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      }),
    ).toThrow(AppError)

    const unsafeImport = join(trackTemp(), 'unsafe-import.json')
    writeFileSync(
      unsafeImport,
      `${JSON.stringify({
        format: PORTABLE_FORMAT,
        schemaVersion: 1,
        exportedAt: 't',
        product: 'Shikumi Local',
        workspaces: [],
        employees: [
          {
            id: 'emp_bad',
            packId: 'bad',
            name: '/opt/secret-employee',
            role: '調査担当',
            defaultProviderId: null,
            createdAt: 't',
            updatedAt: 't',
          },
        ],
        jobs: [],
        events: [],
        artifacts: [],
        growthRecords: [],
        worldUnlocks: [],
        worldFeatureUnlocks: [],
        packs: [],
      })}\n`,
    )
    expect(() => readPortableArchive(unsafeImport)).toThrow(AppError)
  })

  it('does not overwrite an existing export file without --overwrite', () => {
    const dataDirectory = preparedDataDir()
    const destination = join(trackTemp(), 'archive.json')
    writeFileSync(destination, 'keep-me')
    expect(() =>
      exportPortableArchive({
        destination,
        env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      }),
    ).toThrow(AppError)
    expect(readFileSync(destination, 'utf8')).toBe('keep-me')
    const result = exportPortableArchive({
      destination,
      overwrite: true,
      env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    expect(result.preview.format).toBe(PORTABLE_FORMAT)
    expect(readFileSync(destination, 'utf8')).toContain(PORTABLE_FORMAT)
  })

  it('rejects export destinations and import sources that go through symlink ancestors', () => {
    const dataDirectory = preparedDataDir()
    const real = trackTemp()
    const parent = trackTemp()
    const link = join(parent, 'out-link')
    symlinkSync(real, link)
    expect(() =>
      exportPortableArchive({
        destination: join(link, 'archive.json'),
        env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
      }),
    ).toThrow(AppError)

    const archive = join(trackTemp(), 'ok.json')
    exportPortableArchive({
      destination: archive,
      env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    const linkedArchive = join(link, 'ok.json')
    writeFileSync(join(real, 'ok.json'), readFileSync(archive))
    expect(() => readPortableArchive(linkedArchive)).toThrow(AppError)
  })

  it('rejects oversize archives and path traversal sources', () => {
    const huge = join(trackTemp(), 'huge.json')
    writeFileSync(huge, `{${'x'.repeat(MAX_PORTABLE_BYTES + 10)}`)
    expect(() => readPortableArchive(huge)).toThrow(AppError)
    expect(() => readPortableArchive('/tmp/safe/../secret.json')).toThrow(
      AppError,
    )
  })

  it('rolls back the previous data directory when import application fails', () => {
    const archive = join(trackTemp(), 'bad.json')
    writeFileSync(
      archive,
      `${JSON.stringify({
        format: PORTABLE_FORMAT,
        schemaVersion: 1,
        exportedAt: 't',
        product: 'Shikumi Local',
        workspaces: [
          {
            id: 'ws_1',
            name: 'broken',
            worldPackId: 'dog-office',
            defaultProviderId: null,
            createdAt: 't',
            updatedAt: 't',
            repository: {
              displayName: 'broken',
              currentBranch: 'main',
              remoteName: null,
              readable: true,
            },
          },
          {
            id: 'ws_1',
            name: 'duplicate',
            worldPackId: 'dog-office',
            defaultProviderId: null,
            createdAt: 't',
            updatedAt: 't',
            repository: {
              displayName: 'duplicate',
              currentBranch: 'main',
              remoteName: null,
              readable: true,
            },
          },
        ],
        employees: [],
        jobs: [],
        events: [],
        artifacts: [],
        growthRecords: [],
        worldUnlocks: [],
        worldFeatureUnlocks: [],
        packs: [],
      })}\n`,
    )
    const target = preparedDataDir()
    writeFileSync(join(target, 'database.sqlite'), 'preserve-me')
    expect(() =>
      importPortableArchive({
        source: archive,
        confirm: IMPORT_CONFIRM_TOKEN,
        env: { SIKUMI_LOCAL_DATA_DIR: target },
      }),
    ).toThrow()
    expect(readFileSync(join(target, 'database.sqlite'), 'utf8')).toBe(
      'preserve-me',
    )
  })
})

describe('distribution doctor and cli', () => {
  it('runs a read-only doctor report without leaking secrets', async () => {
    const dataDirectory = preparedDataDir()
    const report = await runDoctor({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    expect(report.bind).toBe('127.0.0.1')
    const labels = report.checks.map((check) => check.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Node.js',
        'pnpm',
        'Git',
        'SQLite',
        'Application Data',
        'localhost port',
        'Repository',
        'Codex installed',
        'Codex auth',
        'Codex protocol',
        'Grok Build installed',
        'Grok auth',
        'Grok protocol',
        'Claude Code installed',
        'Claude auth',
        'Claude protocol',
        'Codex sandbox',
        'Grok sandbox',
        'Claude sandbox',
        'Git worktree',
        'SSE',
        'Database migration',
        'Employee packs',
        'Character packs',
        'World packs',
      ]),
    )
    expect(JSON.stringify(report)).not.toContain('sk-')
    expect(JSON.stringify(report)).not.toContain('/Users/')
  })

  it('parses flags and runs setup/reset/export/import through the CLI', async () => {
    expect(parseFlags(['--confirm', 'RESET']).flags.get('confirm')).toBe(
      'RESET',
    )
    const dataDirectory = trackTemp()
    expect(
      await runCli(['setup'], { SIKUMI_LOCAL_DATA_DIR: dataDirectory }),
    ).toBe(0)
    seedHistory(dataDirectory)
    expect(
      await runCli(['reset'], { SIKUMI_LOCAL_DATA_DIR: dataDirectory }),
    ).toBe(0)
    expect(existsSync(join(dataDirectory, 'database.sqlite'))).toBe(true)
    expect(
      await runCli(['reset', '--confirm', RESET_CONFIRM_TOKEN], {
        SIKUMI_LOCAL_DATA_DIR: dataDirectory,
      }),
    ).toBe(0)
    seedHistory(dataDirectory)
    const archive = join(trackTemp(), 'cli.json')
    expect(
      await runCli(['export', '--out', archive], {
        SIKUMI_LOCAL_DATA_DIR: dataDirectory,
      }),
    ).toBe(0)
    const other = preparedDataDir()
    expect(
      await runCli(['import', '--from', archive], {
        SIKUMI_LOCAL_DATA_DIR: other,
      }),
    ).toBe(0)
    expect(
      await runCli(
        ['import', '--from', archive, '--confirm', IMPORT_CONFIRM_TOKEN],
        {
          SIKUMI_LOCAL_DATA_DIR: other,
        },
      ),
    ).toBe(0)
  })
})

describe('distribution path safety', () => {
  it('rejects protected and relative data directories', () => {
    expect(() => assertSafeDataDirectoryInput('relative/data')).toThrow(
      AppError,
    )
    expect(() => assertSafeDataDirectoryInput('/tmp/foo/../secret')).toThrow(
      AppError,
    )
    expect(ensureDataLayout(trackTemp())).toBeTruthy()
  })
})

describe('example packs', () => {
  it('loads the example employee and world as data-only packs', () => {
    const repoRoot = findRepositoryRoot()
    expect(repoRoot).toBeTruthy()
    const employeeRoot = join(repoRoot!, 'examples/packs/example-observer')
    const worldRoot = join(repoRoot!, 'examples/packs/example-garden')
    const pack = loadEmployeePack(employeeRoot, 'installed')
    expect(pack.manifest.id).toBe('example-observer')
    expect(pack.manifest.permissionProfile).toBe('observe')
    expect(readFileSync(join(worldRoot, 'world.yaml'), 'utf8')).toContain(
      'id: example-garden',
    )
  })
})

describe('distribution package script invocation', () => {
  it('runs pnpm data:import --from as Shikumi preview, not pnpm built-in', () => {
    const repoRoot = findRepositoryRoot()
    expect(repoRoot).toBeTruthy()
    const dataDirectory = trackPrivateTmp()
    runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    const archive = join(trackPrivateTmp(), 'shikumi-local.json')
    exportPortableArchive({
      destination: archive,
      env: { SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    const result = spawnSync('pnpm', ['data:import', '--from', archive], {
      cwd: repoRoot!,
      encoding: 'utf8',
      env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/import schema v1/)
    expect(result.stdout).toContain('No files were changed')
    expect(result.stdout).not.toMatch(/pnpm-lock|package-lock|yarn\.lock/i)
    expect(result.stderr).not.toMatch(/ERROR\s+Unknown option: 'from'/i)
  })

  it('runs pnpm data:export --preview and pnpm data:reset as Shikumi CLIs', () => {
    const repoRoot = findRepositoryRoot()
    expect(repoRoot).toBeTruthy()
    const dataDirectory = trackPrivateTmp()
    runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
    const exported = spawnSync('pnpm', ['data:export', '--preview'], {
      cwd: repoRoot!,
      encoding: 'utf8',
      env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    expect(exported.status).toBe(0)
    expect(exported.stdout).toMatch(/export schema v1/)
    const reset = spawnSync('pnpm', ['data:reset'], {
      cwd: repoRoot!,
      encoding: 'utf8',
      env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: dataDirectory },
    })
    expect(reset.status).toBe(0)
    expect(reset.stdout).toContain('Shikumi Local reset preview')
  })
})

function preparedDataDir(): string {
  const dataDirectory = trackTemp()
  runSetup({ SIKUMI_LOCAL_DATA_DIR: dataDirectory })
  return dataDirectory
}

function seedHistory(dataDirectory: string): void {
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
    id: 'emp_export',
    packId: 'saguru',
    name: 'サグル',
    role: '調査担当',
    defaultProviderId: null,
    createdAt: 't',
    updatedAt: 't',
  })
  store.insertJob({
    id: 'job_export',
    workspaceId: workspace.id,
    employeeId: employee.id,
    request: 'TOKEN=sk-live-secret を調べて',
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
  store.insertEvent({
    id: 'evt_export',
    jobId: 'job_export',
    runId: null,
    type: 'run.completed',
    payload: {
      summary: '調査が完了しました',
      reasoning: 'must-not-export',
    },
    occurredAt: 't',
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

function trackPrivateTmp(): string {
  const directory = realpathSync(mkdtempSync('/private/tmp/sikumi-local-data-'))
  expect(directory.startsWith('/private/tmp/')).toBe(true)
  tempDirectories.push(directory)
  return directory
}
