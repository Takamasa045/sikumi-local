import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { isInsideRoot } from '@sikumi-local/process-runtime'

const EMPLOYEE_SLUG = /^[a-z][a-z0-9-]{1,62}$/
const JOB_SHORT = /^[a-z0-9]{6,12}$/
const BRANCH_PATTERN = /^shikumi\/[a-z][a-z0-9-]{1,62}\/[a-z0-9]{6,12}$/
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

export function worktreesRoot(dataDirectory: string): string {
  return join(dataDirectory, 'worktrees')
}

export function exportsRoot(dataDirectory: string): string {
  return join(dataDirectory, 'exports')
}

export function jobShortId(jobId: string): string {
  const short = jobId.replace(/-/g, '').toLowerCase().slice(0, 8)
  if (!JOB_SHORT.test(short)) {
    throw new AppError('VALIDATION_FAILED', 'Job id is not safe', 400)
  }
  return short
}

export function worktreeBranchName(employeeId: string, jobId: string): string {
  if (!EMPLOYEE_SLUG.test(employeeId)) {
    throw new AppError('VALIDATION_FAILED', 'Employee id is not safe', 400)
  }
  const branch = `shikumi/${employeeId}/${jobShortId(jobId)}`
  if (!BRANCH_PATTERN.test(branch)) {
    throw new AppError('VALIDATION_FAILED', 'Worktree branch is not safe', 400)
  }
  return branch
}

export function assertSafeBranchName(branch: string): string {
  if (!BRANCH_PATTERN.test(branch)) {
    throw new AppError('VALIDATION_FAILED', 'Worktree branch is not safe', 400)
  }
  return branch
}

export function sanitizeIdSegment(value: string, label: string): string {
  const trimmed = value.trim()
  if (!SAFE_SEGMENT.test(trimmed) || trimmed.includes('..')) {
    throw new AppError(
      'PATH_TRAVERSAL',
      `${label} is not a safe path segment`,
      400,
    )
  }
  return trimmed
}

export function worktreeRelPath(repositoryId: string, jobId: string): string {
  return join(
    'worktrees',
    sanitizeIdSegment(repositoryId, 'repositoryId'),
    sanitizeIdSegment(jobId, 'jobId'),
  )
}

export function resolveContainedDirectory(
  dataDirectory: string,
  relativePath: string,
): string {
  const dataReal = realpathSync(dataDirectory)
  const candidate = join(dataReal, relativePath)
  if (relativePath.split(/[/\\]/).includes('..')) {
    throw new AppError('PATH_TRAVERSAL', 'Path escapes the data directory', 400)
  }
  mkdirSync(join(dataReal, relativePath.split(/[/\\]/)[0] ?? 'worktrees'), {
    recursive: true,
    mode: 0o700,
  })
  if (!candidate.startsWith(dataReal)) {
    throw new AppError('PATH_TRAVERSAL', 'Path escapes the data directory', 400)
  }
  return candidate
}

export function assertInsideDataDirectory(
  candidate: string,
  dataDirectory: string,
): string {
  let realCandidate: string
  let realRoot: string
  try {
    realCandidate = realpathSync(candidate)
    realRoot = realpathSync(dataDirectory)
  } catch {
    throw new AppError('PATH_TRAVERSAL', 'Path could not be resolved', 400)
  }
  if (!isInsideRoot(realCandidate, realRoot)) {
    throw new AppError('PATH_TRAVERSAL', 'Path escapes the data directory', 400)
  }
  return realCandidate
}

export function assertInsideWorktreesRoot(
  candidate: string,
  dataDirectory: string,
): string {
  const root = worktreesRoot(dataDirectory)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const realRoot = realpathSync(root)
  let realCandidate: string
  try {
    realCandidate = realpathSync(candidate)
  } catch {
    const parent = join(candidate, '..')
    const realParent = realpathSync(parent)
    if (!isInsideRoot(realParent, realRoot)) {
      throw new AppError(
        'PATH_TRAVERSAL',
        'Worktree path is not contained',
        400,
      )
    }
    return candidate
  }
  if (!isInsideRoot(realCandidate, realRoot)) {
    throw new AppError('PATH_TRAVERSAL', 'Worktree path is not contained', 400)
  }
  return realCandidate
}
