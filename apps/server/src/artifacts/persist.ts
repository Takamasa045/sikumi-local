import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { AppError, type ArtifactType } from '@sikumi-local/core'
import { isInsideRoot } from '@sikumi-local/process-runtime'

export function persistJobArtifactFile(input: {
  readonly dataDirectory: string
  readonly jobId: string
  readonly artifactId: string
  readonly artifactType: ArtifactType
  readonly title: string
  readonly content: string
}): string {
  const jobId = sanitizePathSegment(input.jobId, 'jobId')
  const artifactId = sanitizePathSegment(input.artifactId, 'artifactId')
  const kind =
    input.artifactType === 'report' || input.artifactType === 'markdown'
      ? 'reports'
      : 'artifacts'
  const extension =
    input.artifactType === 'report'
      ? '.json'
      : input.artifactType === 'markdown'
        ? '.md'
        : input.artifactType === 'patch' || input.artifactType === 'code_diff'
          ? '.patch'
          : '.txt'
  const filename = `${sanitizePathSegment(input.title, 'title')}-${artifactId}${extension}`
  mkdirSync(input.dataDirectory, { recursive: true, mode: 0o700 })
  const directory = join(input.dataDirectory, kind, jobId)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!isInsideRoot(directory, input.dataDirectory)) {
    throw new AppError(
      'PATH_TRAVERSAL',
      'Artifact path is not inside the data directory',
      400,
    )
  }

  const target = join(directory, filename)
  const temporary = join(directory, `.${filename}.tmp`)
  try {
    writeFileSync(temporary, input.content, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, target)
    chmodSync(target, 0o600)
  } catch (error) {
    rmSync(temporary, { force: true })
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError('VALIDATION_FAILED', '成果を保存できませんでした', 500)
  }
  return target
}

function sanitizePathSegment(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new AppError('VALIDATION_FAILED', `${label} is required`, 400)
  }
  if (
    trimmed.includes('\0') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.split(/[/\\]/).includes('..') ||
    trimmed === '.' ||
    trimmed === '..'
  ) {
    throw new AppError(
      'PATH_TRAVERSAL',
      `${label} is not a safe path segment`,
      400,
    )
  }
  return (
    trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') ||
    'artifact'
  )
}
