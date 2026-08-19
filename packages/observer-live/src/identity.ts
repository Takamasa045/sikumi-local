import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeComparablePath } from '@sikumi-local/observer-core'
import { resolveExistingRoot, runGit } from '@sikumi-local/observer-git'

export type PlaceIdentity = {
  readonly gitRoot: string | null
  readonly remote: string | null
  readonly packageName: string | null
}

const identityCache = new Map<string, PlaceIdentity>()

export function readPlaceIdentity(
  path: string | null | undefined,
): PlaceIdentity {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) {
    return { gitRoot: null, remote: null, packageName: null }
  }
  const cacheKey = normalizeComparablePath(trimmed)
  const cached = identityCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const existing = resolveExistingRoot(trimmed)
  const probe = existing ?? trimmed
  const toplevel = emptyToNull(runGit(probe, ['rev-parse', '--show-toplevel']))
  const gitRoot = toplevel
    ? (resolveExistingRoot(toplevel) ?? normalizeComparablePath(toplevel))
    : null
  const home = gitRoot ?? existing
  const remote = home
    ? normalizeRemoteUrl(
        emptyToNull(runGit(home, ['config', '--get', 'remote.origin.url'])) ??
          emptyToNull(
            runGit(home, ['remote', 'get-url', 'origin'], {
              allowedFailure: true,
            }),
          ),
      )
    : null
  const packageName = home ? readPackageName(home) : null
  const identity = { gitRoot, remote, packageName }
  if (gitRoot || remote || packageName) {
    identityCache.set(cacheKey, identity)
  }
  return identity
}

export function sameRepoIdentity(
  leftPath: string | null | undefined,
  rightPath: string | null | undefined,
): boolean {
  const left = readPlaceIdentity(leftPath)
  const right = readPlaceIdentity(rightPath)
  if (left.gitRoot && right.gitRoot && left.gitRoot === right.gitRoot) {
    return true
  }
  if (left.remote && right.remote) {
    return left.remote === right.remote
  }
  if (left.packageName && right.packageName) {
    return left.packageName === right.packageName
  }
  return false
}

export function normalizeRemoteUrl(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) {
    return null
  }
  let remote = trimmed.replace(/\.git$/i, '')
  const ssh = /^git@([^:]+):(.+)$/i.exec(remote)
  if (ssh) {
    remote = `https://${ssh[1]}/${ssh[2]}`
  } else {
    remote = remote.replace(/^ssh:\/\/git@/i, 'https://')
  }
  return remote.replace(/\/+$/, '').toLowerCase()
}

export function resetPlaceIdentityCache(): void {
  identityCache.clear()
}

function readPackageName(folder: string): string | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(folder, 'package.json'), 'utf8'),
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const name = (parsed as { name?: unknown }).name
    if (typeof name !== 'string') {
      return null
    }
    const trimmed = name.trim()
    return trimmed || null
  } catch {
    return null
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}
