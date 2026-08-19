import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { canonicalizeObservedPath } from './paths.js'

export interface RegisteredRepositoryRecord {
  readonly id: string
  readonly displayName: string
  readonly absolutePath: string
  readonly canonicalPath: string
}

export interface RegisteredRepositoryCatalog {
  readonly schemaVersion: 1
  readonly updatedAt: string
  readonly repositories: readonly RegisteredRepositoryRecord[]
}

export function registeredRepositoryCatalogPath(dataDirectory: string): string {
  return join(dataDirectory, 'observer', 'registered-repositories.json')
}

export function writeRegisteredRepositoryCatalog(
  dataDirectory: string,
  repositories: ReadonlyArray<{
    readonly id: string
    readonly displayName: string
    readonly absolutePath: string
  }>,
  now = new Date().toISOString(),
): string {
  const catalog: RegisteredRepositoryCatalog = {
    schemaVersion: 1,
    updatedAt: now,
    repositories: repositories.map((repository) => ({
      id: repository.id,
      displayName: repository.displayName,
      absolutePath: repository.absolutePath,
      canonicalPath:
        canonicalizeObservedPath(repository.absolutePath) ??
        repository.absolutePath,
    })),
  }
  const path = registeredRepositoryCatalogPath(dataDirectory)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(temp, path)
  return path
}

export function readRegisteredRepositoryCatalog(
  dataDirectory: string,
): RegisteredRepositoryCatalog {
  const path = registeredRepositoryCatalogPath(dataDirectory)
  if (!existsSync(path)) {
    return { schemaVersion: 1, updatedAt: '', repositories: [] }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isCatalog(parsed)) {
      return { schemaVersion: 1, updatedAt: '', repositories: [] }
    }
    return parsed
  } catch {
    return { schemaVersion: 1, updatedAt: '', repositories: [] }
  }
}

function isCatalog(value: unknown): value is RegisteredRepositoryCatalog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || !Array.isArray(record.repositories)) {
    return false
  }
  return record.repositories.every((item) => {
    if (typeof item !== 'object' || item === null) {
      return false
    }
    const repo = item as Record<string, unknown>
    return (
      typeof repo.id === 'string' &&
      typeof repo.displayName === 'string' &&
      typeof repo.absolutePath === 'string' &&
      typeof repo.canonicalPath === 'string'
    )
  })
}
