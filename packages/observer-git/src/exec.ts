import { execFileSync } from 'node:child_process'
import { OBSERVER_GIT_MAX_OUTPUT_BYTES } from '@sikumi-local/observer-core'
import { resolveCommandOnPath } from '@sikumi-local/process-runtime'

const GIT_TIMEOUT_MS = 12_000

export function resolveGitExecutable(): string | null {
  return resolveCommandOnPath('git') ?? null
}

export function runGit(
  cwd: string,
  args: readonly string[],
  options?: { readonly allowedFailure?: boolean },
): string | null {
  const git = resolveGitExecutable()
  if (!git) {
    return null
  }
  try {
    return execFileSync(git, ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: OBSERVER_GIT_MAX_OUTPUT_BYTES,
      windowsHide: true,
    }).trimEnd()
  } catch (error) {
    if (options?.allowedFailure) {
      return String((error as { stdout?: string }).stdout ?? '').trimEnd()
    }
    return null
  }
}
