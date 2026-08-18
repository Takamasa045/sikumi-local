import { execFileSync } from 'node:child_process'
import { AppError } from '@sikumi-local/core'
import { resolveCommandOnPath } from '@sikumi-local/process-runtime'

const GIT_TIMEOUT_MS = 15_000
const MAX_OUTPUT_BYTES = 512_000

export function resolveGitExecutable(): string {
  const resolved = resolveCommandOnPath('git')
  if (!resolved) {
    throw new AppError('WORKTREE_CREATE_FAILED', 'Gitが見つかりません', 500)
  }
  return resolved
}

export function runGit(
  cwd: string,
  args: readonly string[],
  options?: {
    readonly timeoutMs?: number
    readonly allowedFailure?: boolean
    readonly trim?: boolean
  },
): string {
  const git = resolveGitExecutable()
  try {
    const output = execFileSync(git, ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options?.timeoutMs ?? GIT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    })
    return options?.trim === false ? output : output.trim()
  } catch (error) {
    if (options?.allowedFailure) {
      const stdout = String((error as { stdout?: string }).stdout ?? '').trim()
      return stdout
    }
    throw mapGitError(error)
  }
}

export function runGitBytes(cwd: string, args: readonly string[]): Buffer {
  const git = resolveGitExecutable()
  try {
    return execFileSync(git, ['-C', cwd, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    })
  } catch (error) {
    throw mapGitError(error)
  }
}

export function runGitWithStdin(
  cwd: string,
  args: readonly string[],
  stdin: string,
): void {
  const git = resolveGitExecutable()
  execFileSync(git, ['-C', cwd, ...args], {
    input: stdin,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  })
}

function mapGitError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }
  const code = (error as { code?: string | number }).code
  if (code === 'ETIMEDOUT') {
    return new AppError('WORKTREE_CREATE_FAILED', 'Git操作が時間切れです', 500)
  }
  return new AppError('WORKTREE_CREATE_FAILED', 'Git操作に失敗しました', 400)
}
