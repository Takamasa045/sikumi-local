import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { AppError } from '@sikumi-local/core'

const MAX_PATH_LENGTH = 4096

export function resolveRegisteredPath(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new AppError(
      'REPOSITORY_NOT_FOUND',
      '指定した場所が見つかりません',
      404,
    )
  }
  if (trimmed.length > MAX_PATH_LENGTH) {
    throw new AppError('VALIDATION_FAILED', 'Repository path is too long', 400)
  }
  if (trimmed.includes('\0')) {
    throw new AppError('PATH_TRAVERSAL', 'このパスは安全に扱えません', 400)
  }

  const segments = trimmed.split(/[/\\]/)
  if (segments.includes('..')) {
    throw new AppError('PATH_TRAVERSAL', 'このパスは安全に扱えません', 400)
  }

  const expanded = expandHomeDirectory(trimmed)
  if (!isAbsolute(expanded)) {
    throw new AppError(
      'REPOSITORY_NOT_FOUND',
      'Repository path must be absolute',
      404,
    )
  }

  const resolved = resolve(expanded)
  if (resolved.split(/[/\\]/).includes('..')) {
    throw new AppError('PATH_TRAVERSAL', 'このパスは安全に扱えません', 400)
  }

  return resolved
}

function expandHomeDirectory(input: string): string {
  if (input === '~') {
    return homedir()
  }
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return resolve(homedir(), input.slice(2))
  }
  return input
}
