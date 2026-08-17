import { execFileSync } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { AppError, redactRemoteUrl } from '@sikumi-local/core'

export interface GitInspection {
  readonly absolutePath: string
  readonly displayName: string
  readonly currentBranch: string | null
  readonly remoteName: string | null
  readonly remoteUrl: string | null
  readonly readable: boolean
}

const GIT_TIMEOUT_MS = 5_000

export function inspectGitRepository(absolutePath: string): GitInspection {
  let realPath: string
  try {
    const stats = statSync(absolutePath)
    if (!stats.isDirectory()) {
      throw new AppError(
        'REPOSITORY_NOT_FOUND',
        '指定した場所が見つかりません',
        404,
      )
    }
    accessSync(absolutePath, constants.R_OK)
    realPath = realpathSync(absolutePath)
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    throw mapFilesystemError(error)
  }

  const inside = git(realPath, ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') {
    throw new AppError(
      'REPOSITORY_NOT_GIT',
      'Git Repositoryではありません',
      400,
    )
  }

  const toplevel = realpathSync(git(realPath, ['rev-parse', '--show-toplevel']))
  if (toplevel !== realPath) {
    throw new AppError(
      'REPOSITORY_NOT_GIT',
      'Git Repositoryのルートだけを登録できます',
      400,
    )
  }

  const currentBranch = emptyToNull(git(realPath, ['branch', '--show-current']))
  const remoteNames = git(realPath, ['remote'])
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  const remoteName = remoteNames.includes('origin')
    ? 'origin'
    : (remoteNames[0] ?? null)
  const remoteUrl = remoteName
    ? redactRemoteUrl(git(realPath, ['remote', 'get-url', remoteName]))
    : null

  return {
    absolutePath: realPath,
    displayName: basename(realPath),
    currentBranch,
    remoteName,
    remoteUrl,
    readable: true,
  }
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
    }).trim()
  } catch (error) {
    if (isPermissionError(error)) {
      throw new AppError(
        'REPOSITORY_PERMISSION_DENIED',
        'この場所を読み取れません',
        403,
      )
    }
    throw new AppError(
      'REPOSITORY_NOT_GIT',
      'Git Repositoryではありません',
      400,
    )
  }
}

function mapFilesystemError(error: unknown): AppError {
  if (isPermissionError(error)) {
    return new AppError(
      'REPOSITORY_PERMISSION_DENIED',
      'この場所を読み取れません',
      403,
    )
  }
  return new AppError(
    'REPOSITORY_NOT_FOUND',
    '指定した場所が見つかりません',
    404,
  )
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: string }).code
  const stderr = String((error as { stderr?: string }).stderr ?? '')
  return (
    code === 'EACCES' || code === 'EPERM' || /permission denied/i.test(stderr)
  )
}

function emptyToNull(value: string): string | null {
  return value.length === 0 ? null : value
}
