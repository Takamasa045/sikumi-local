import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSafeOwnedTempDirectory } from './owned-temp-guard.mjs'

export {
  isSafeOwnedTempDirectory,
  OWNED_E2E_TEMP_PREFIXES,
} from './owned-temp-guard.mjs'

const OWNED_PATHS_FILE = 'e2e-owned-paths.json'

export function trackOwnedDirectory(directory: string): string {
  const filePath = ownedPathsFile()
  if (!filePath || !isSafeOwnedTempDirectory(directory)) {
    return directory
  }
  const current = readOwnedDirectories()
  if (!current.includes(directory)) {
    current.push(directory)
    writeFileSync(filePath, `${JSON.stringify(current)}\n`, 'utf8')
  }
  return directory
}

export function readOwnedDirectories(): string[] {
  const filePath = ownedPathsFile()
  if (!filePath || !existsSync(filePath)) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (entry): entry is string =>
        typeof entry === 'string' && isSafeOwnedTempDirectory(entry),
    )
  } catch {
    return []
  }
}

export function createTemporaryGitRepository(prefix: string): string {
  const directory = trackOwnedDirectory(mkdtempSync(join(tmpdir(), prefix)))
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], {
    cwd: directory,
  })
  execFileSync('git', ['config', 'user.name', 'e2e'], { cwd: directory })
  writeFileSync(join(directory, 'README.md'), `# ${prefix}\n`)
  execFileSync('git', ['add', 'README.md'], { cwd: directory })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: directory })
  return directory
}

function ownedPathsFile(): string | null {
  const dataDirectory = process.env.SIKUMI_E2E_DATA_DIR
  if (!dataDirectory) {
    return null
  }
  mkdirSync(dataDirectory, { recursive: true })
  return join(dataDirectory, OWNED_PATHS_FILE)
}
