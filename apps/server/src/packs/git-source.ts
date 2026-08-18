import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { resolveGitExecutable } from '../git/exec.js'
import { packError } from './inspect-tree.js'

const ALLOWED_SCHEMES = new Set(['file:', 'https:'])

export function assertSafeGitUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > 2048) {
    throw packError('Git URL is invalid')
  }
  if (trimmed.includes('\0') || trimmed.includes(' ')) {
    throw packError('Git URL is invalid')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw packError('Git URL is invalid')
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw packError('Git URL scheme is not allowed')
  }
  if (
    parsed.protocol === 'file:' &&
    parsed.hostname.length > 0 &&
    parsed.hostname !== 'localhost'
  ) {
    throw packError('Git URL is invalid')
  }
  if (parsed.username || parsed.password) {
    throw new AppError(
      'PACK_CREDENTIALS_FORBIDDEN',
      'Git URL must not contain credentials',
      400,
    )
  }
  return parsed.toString()
}

export function displayGitSource(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol === 'file:') {
    return 'local git repository'
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
}

export function clonePackRepository(
  url: string,
  destination: string,
): { commit: string; changes: string } {
  const safeUrl = assertSafeGitUrl(url)
  const git = resolveGitExecutable()
  const parent = dirname(destination)
  try {
    execFileSync(
      git,
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.symlinks=false',
        'clone',
        '--no-recurse-submodules',
        '--depth',
        '50',
        '--',
        safeUrl,
        destination,
      ],
      {
        cwd: parent,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
        windowsHide: true,
      },
    )
  } catch {
    throw packError('Pack repository could not be cloned')
  }
  if (existsSync(`${destination}/.gitmodules`)) {
    throw packError('Pack repository must not contain submodules')
  }
  try {
    const commit = execFileSync(git, ['-C', destination, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
      windowsHide: true,
    }).trim()
    const changes = execFileSync(
      git,
      ['-C', destination, 'log', '-1', '--stat', '--pretty=format:%s'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5_000,
        windowsHide: true,
      },
    ).trim()
    return { commit, changes }
  } catch {
    throw packError('Pack repository commit could not be read')
  }
}
