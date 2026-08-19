import { existsSync, statSync, watch } from 'node:fs'
import { resolve } from 'node:path'

export interface WatchedRepositoryRoot {
  readonly repositoryId: string
  readonly rootPath: string
}

export interface RepositoryWatcherHandle {
  close(): void
  on?(event: 'error', listener: (error: Error) => void): void
  unref?(): void
}

export interface RepositoryWatcherCoordinator {
  reconcile(repositories: readonly WatchedRepositoryRoot[]): void
  watchedRoots(): readonly WatchedRepositoryRoot[]
  dispose(): void
}

export function createRepositoryWatcherCoordinator(input: {
  readonly schedule: (repositoryId: string) => void
  readonly watchFn?: (
    rootPath: string,
    listener: (eventType: string, filename: string | Buffer | null) => void,
  ) => RepositoryWatcherHandle
  readonly isWatchable?: (rootPath: string) => boolean
}): RepositoryWatcherCoordinator {
  const watchFn = input.watchFn ?? watchRegisteredRoot
  const isWatchable = input.isWatchable ?? isWatchableDirectory
  const active = new Map<
    string,
    { readonly rootPath: string; readonly handle: RepositoryWatcherHandle }
  >()
  let disposed = false

  function closeWatcher(repositoryId: string): void {
    const current = active.get(repositoryId)
    if (!current) {
      return
    }
    active.delete(repositoryId)
    try {
      current.handle.close()
    } catch {
      // fail-soft: a dead watcher must not break reconcile
    }
  }

  function startWatcher(repositoryId: string, rootPath: string): void {
    try {
      const handle = watchFn(rootPath, () => {
        if (disposed) {
          return
        }
        input.schedule(repositoryId)
      })
      handle.unref?.()
      handle.on?.('error', () => {
        closeWatcher(repositoryId)
      })
      active.set(repositoryId, { rootPath, handle })
    } catch {
      // fail-soft: unavailable or unwatchable roots stay unscanned here
    }
  }

  return {
    reconcile(repositories) {
      if (disposed) {
        return
      }
      const wanted = new Map<string, string>()
      for (const repository of repositories) {
        wanted.set(repository.repositoryId, resolve(repository.rootPath))
      }

      for (const [repositoryId, current] of active) {
        const nextPath = wanted.get(repositoryId)
        if (
          nextPath === undefined ||
          nextPath !== current.rootPath ||
          !safeWatchable(isWatchable, nextPath)
        ) {
          closeWatcher(repositoryId)
        }
      }

      for (const [repositoryId, rootPath] of wanted) {
        if (active.has(repositoryId) || !safeWatchable(isWatchable, rootPath)) {
          continue
        }
        startWatcher(repositoryId, rootPath)
      }
    },
    watchedRoots() {
      return [...active.entries()].map(([repositoryId, current]) => ({
        repositoryId,
        rootPath: current.rootPath,
      }))
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      for (const repositoryId of [...active.keys()]) {
        closeWatcher(repositoryId)
      }
    },
  }
}

function watchRegisteredRoot(
  rootPath: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
): RepositoryWatcherHandle {
  const watcher = watch(
    rootPath,
    { persistent: false, recursive: true },
    listener,
  )
  watcher.unref?.()
  return watcher
}

function isWatchableDirectory(rootPath: string): boolean {
  try {
    return existsSync(rootPath) && statSync(rootPath).isDirectory()
  } catch {
    return false
  }
}

function safeWatchable(
  isWatchable: (rootPath: string) => boolean,
  rootPath: string,
): boolean {
  try {
    return isWatchable(rootPath)
  } catch {
    return false
  }
}

export function unrefTimer(timer: unknown): void {
  if (
    typeof timer === 'object' &&
    timer !== null &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  ) {
    timer.unref()
  }
}
