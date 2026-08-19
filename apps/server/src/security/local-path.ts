import { homedir } from 'node:os'
import { isAbsolute, resolve, win32 } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { looksWindowsAbsolutePath } from '@sikumi-local/observer-core'
import { assertNoPathTraversal } from '@sikumi-local/process-runtime'

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

  const decoded = decodeRegisteredPath(trimmed)
  const expanded = expandHomeDirectory(decoded)
  decodeRegisteredPath(expanded.normalize('NFKC'))
  if (!isAbsolute(expanded) && !looksWindowsAbsolutePath(expanded)) {
    throw new AppError(
      'REPOSITORY_NOT_FOUND',
      'Repository path must be absolute',
      404,
    )
  }

  const resolved = looksWindowsAbsolutePath(expanded)
    ? process.platform === 'win32'
      ? resolve(expanded)
      : win32.normalize(expanded)
    : resolve(expanded)
  decodeRegisteredPath(resolved)
  return resolved
}

function decodeRegisteredPath(input: string): string {
  if (hasUnicodeParentTraversal(input)) {
    throw new AppError('PATH_TRAVERSAL', 'このパスは安全に扱えません', 400)
  }
  try {
    return assertNoPathTraversal(input)
  } catch (error) {
    if (error instanceof AppError && error.code === 'PATH_TRAVERSAL') {
      throw new AppError('PATH_TRAVERSAL', 'このパスは安全に扱えません', 400)
    }
    throw error
  }
}

function hasUnicodeParentTraversal(input: string): boolean {
  const forms = [input, input.normalize('NFKC'), input.normalize('NFKD')]
  return forms.some((form) =>
    form.split(/[/\\]/).some((segment) => {
      const normalized = segment.normalize('NFKC')
      return (
        normalized === '..' ||
        normalized.replace(
          /[\u00B7\u2024\u2025\u2026\u2219\u22C5\uFE52\uFF0E]/g,
          '.',
        ) === '..'
      )
    }),
  )
}

function expandHomeDirectory(input: string): string {
  if (input === '~') {
    return homedir()
  }
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return resolve(homedir(), ...input.slice(2).split(/[/\\]/).filter(Boolean))
  }
  return input
}
