import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMPORT_CONFIRM_TOKEN, RESET_CONFIRM_TOKEN } from './args.js'
import { runCli } from './cli.js'
import { findRepositoryRoot } from './paths.js'

const PRIVATE_TMP = '/private/tmp'
const PNPM_RESERVED_COMMANDS = new Set([
  'add',
  'audit',
  'bin',
  'config',
  'deploy',
  'dlx',
  'env',
  'exec',
  'fetch',
  'import',
  'install',
  'licenses',
  'link',
  'list',
  'outdated',
  'pack',
  'prune',
  'publish',
  'rebuild',
  'recursive',
  'remove',
  'root',
  'run',
  'store',
  'unlink',
  'update',
  'why',
])

const tempDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('package-level pnpm data scripts', () => {
  it('exposes data:* scripts that do not collide with pnpm reserved commands', () => {
    const repoRoot = requireRepoRoot()
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}

    expect(scripts['data:import']).toBe('node scripts/import.mjs')
    expect(scripts['data:export']).toBe('node scripts/export.mjs')
    expect(scripts['data:reset']).toBe('node scripts/reset.mjs')
    expect(scripts.setup).toBe('node scripts/setup.mjs')
    expect(scripts.doctor).toBe('node scripts/doctor.mjs')

    for (const name of ['data:import', 'data:export', 'data:reset'] as const) {
      expect(PNPM_RESERVED_COMMANDS.has(name)).toBe(false)
      expect(PNPM_RESERVED_COMMANDS.has(name.split(':')[0] ?? '')).toBe(false)
    }
  })

  it('documents pnpm data:import instead of the reserved pnpm import command', () => {
    const repoRoot = requireRepoRoot()
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')
    const troubleshooting = readFileSync(
      join(repoRoot, 'docs/troubleshooting.md'),
      'utf8',
    )

    for (const text of [readme, troubleshooting]) {
      expect(text).toMatch(/pnpm data:import --from /)
      expect(text).toMatch(/pnpm data:export --preview/)
      expect(text).toMatch(/pnpm data:reset/)
      expect(text).not.toMatch(/pnpm import --/)
    }

    expect(readme).toMatch(/pnpm setup/)
    expect(readme).toMatch(/pnpm start/)
    expect(readme).toMatch(/pnpm doctor/)
  })

  it('prints data:* usage instead of reserved pnpm import', async () => {
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((message) => {
      errors.push(String(message))
    })

    expect(await runCli(['unknown'])).toBe(1)
    expect(await runCli(['import'])).toBe(1)

    const printed = errors.join('\n')
    expect(printed).toContain('pnpm data:import --from')
    expect(printed).toContain('pnpm data:export')
    expect(printed).toContain('pnpm data:reset')
    expect(printed).not.toMatch(/pnpm import --from/)
  })

  it('spawns documented pnpm data:* commands with arguments against /private/tmp', () => {
    const repoRoot = requireRepoRoot()
    const workspace = createPrivateTmpDirectory('sikumi-cli-workspace-')
    const dataDirectory = join(workspace, 'data')
    const archive = join(workspace, 'shikumi-local.json')
    const env = isolatedEnv(dataDirectory)

    const reserved = runPnpm(['import', '--from', archive], repoRoot, env)
    expect(reserved.status).not.toBe(0)
    expect(stripAnsi(`${reserved.stdout}\n${reserved.stderr}`)).toMatch(
      /Unknown option:\s*'?from'?|Usage:\s*pnpm import|pnpm help import/i,
    )
    expect(`${reserved.stdout}\n${reserved.stderr}`).not.toContain(
      'Shikumi Local',
    )

    const setup = runPnpm(['setup'], repoRoot, env)
    expect(setup.status).toBe(0)
    expect(setup.stdout).toContain('Shikumi Local setup complete')
    expect(existsSync(join(dataDirectory, '.shikumi-local.json'))).toBe(true)

    const exported = runPnpm(['data:export', '--out', archive], repoRoot, env)
    expect(exported.status).toBe(0)
    expect(exported.stdout).toContain('Shikumi Local export complete')
    expect(existsSync(archive)).toBe(true)

    const preview = runPnpm(['data:import', '--from', archive], repoRoot, env)
    expect(preview.status).toBe(0)
    expect(preview.stdout).toContain('import schema')
    expect(preview.stdout).toContain('No files were changed')
    expect(`${preview.stdout}\n${preview.stderr}`).not.toMatch(
      /Unknown option:\s*from/i,
    )

    const applied = runPnpm(
      ['data:import', '--from', archive, '--confirm', IMPORT_CONFIRM_TOKEN],
      repoRoot,
      env,
    )
    expect(applied.status).toBe(0)
    expect(applied.stdout).toContain('Shikumi Local import complete')

    const doctor = runPnpm(['doctor'], repoRoot, env)
    expect(doctor.status).toBe(0)
    expect(doctor.stdout).toContain('Shikumi Local Doctor')

    const resetPreview = runPnpm(['data:reset'], repoRoot, env)
    expect(resetPreview.status).toBe(0)
    expect(resetPreview.stdout).toContain('Shikumi Local reset preview')

    const resetApplied = runPnpm(
      ['data:reset', '--confirm', RESET_CONFIRM_TOKEN],
      repoRoot,
      env,
    )
    expect(resetApplied.status).toBe(0)
    expect(resetApplied.stdout).toContain('Shikumi Local reset complete')
  }, 60_000)
})

function requireRepoRoot(): string {
  const repoRoot = findRepositoryRoot()
  expect(repoRoot).toBeTruthy()
  return repoRoot!
}

function createPrivateTmpDirectory(prefix: string): string {
  expect(existsSync(PRIVATE_TMP)).toBe(true)
  const directory = realpathSync(mkdtempSync(join(PRIVATE_TMP, prefix)))
  expect(directory.startsWith(`${PRIVATE_TMP}/`)).toBe(true)
  tempDirectories.push(directory)
  return directory
}

function isolatedEnv(dataDirectory: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SIKUMI_LOCAL_DATA_DIR: dataDirectory,
  }
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value)
}

function runPnpm(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('pnpm', [...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
