import { runGit } from './exec.js'

const DEFAULT_BRANCH_REFS = [
  'refs/remotes/origin/main',
  'refs/remotes/origin/master',
  'refs/heads/main',
  'refs/heads/master',
] as const

export function resolveMergeBase(
  cwd: string,
  left: string | null,
  right: string | null,
): string | null {
  if (!left || !right) {
    return null
  }
  if (left === right) {
    return left
  }
  return emptyToNull(
    runGit(cwd, ['merge-base', left, right], { allowedFailure: true }),
  )
}

export function resolveDefaultBranchRef(cwd: string): string | null {
  const originHead = emptyToNull(
    runGit(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
      allowedFailure: true,
    }),
  )
  if (originHead) {
    return originHead
  }
  for (const ref of DEFAULT_BRANCH_REFS) {
    const sha = emptyToNull(
      runGit(cwd, ['rev-parse', '--verify', ref], { allowedFailure: true }),
    )
    if (sha) {
      return ref
    }
  }
  return null
}

export function resolveRepositoryBaseCommit(
  cwd: string,
  headCommit: string | null,
): string | null {
  const ref = resolveDefaultBranchRef(cwd)
  if (!ref || !headCommit) {
    return null
  }
  const target = emptyToNull(
    runGit(cwd, ['rev-parse', '--verify', ref], { allowedFailure: true }),
  )
  if (!target || target === headCommit) {
    return null
  }
  return resolveMergeBase(cwd, target, headCommit)
}

export function resolveWorktreeBaseCommit(
  cwd: string,
  headCommit: string | null,
  primaryHead: string | null,
  isPrimary: boolean,
): string | null {
  if (!isPrimary && primaryHead && headCommit && primaryHead !== headCommit) {
    const shared = resolveMergeBase(cwd, headCommit, primaryHead)
    if (shared) {
      return shared
    }
  }
  return resolveRepositoryBaseCommit(cwd, headCommit)
}

function emptyToNull(value: string | null): string | null {
  if (!value || value.length === 0) {
    return null
  }
  return value
}
