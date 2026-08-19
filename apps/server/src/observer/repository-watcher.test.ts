import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScanScheduler } from './scan-scheduler.js'
import {
  createRepositoryWatcherCoordinator,
  type RepositoryWatcherHandle,
} from './repository-watcher.js'

const tempDirectories: string[] = []
const coordinators: Array<ReturnType<typeof createRepositoryWatcherCoordinator>> =
  []

afterEach(() => {
  vi.useRealTimers()
  for (const coordinator of coordinators.splice(0)) {
    coordinator.dispose()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('createRepositoryWatcherCoordinator', () => {
  it('schedules a Git rescan from a file notification and does not assert state itself', () => {
    const schedule = vi.fn()
    const assertState = vi.fn()
    const { coordinator, listeners } = createInjectedCoordinator(schedule)

    coordinator.reconcile([
      { repositoryId: 'repo-1', rootPath: '/registered/repo-1' },
    ])
    expect(listeners.size).toBe(1)
    listeners.get('/registered/repo-1')?.('change', 'src/app.ts')

    expect(schedule).toHaveBeenCalledTimes(1)
    expect(schedule).toHaveBeenCalledWith('repo-1')
    expect(assertState).not.toHaveBeenCalled()
  })

  it('watches only registered roots and never parent directories', () => {
    const watched: string[] = []
    const registered = resolve('/registered/repo-1')
    const parent = resolve('/registered')
    const outsider = resolve('/unregistered/other')
    const coordinator = trackCoordinator(
      createRepositoryWatcherCoordinator({
        schedule: vi.fn(),
        isWatchable: () => true,
        watchFn: (rootPath) => {
          watched.push(rootPath)
          return createHandle()
        },
      }),
    )

    coordinator.reconcile([
      { repositoryId: 'repo-1', rootPath: registered },
    ])

    expect(watched).toEqual([registered])
    expect(watched).not.toContain(parent)
    expect(watched).not.toContain(outsider)
    expect(coordinator.watchedRoots()).toEqual([
      { repositoryId: 'repo-1', rootPath: registered },
    ])
  })

  it('debounces burst file events through the scan scheduler', () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const scheduler = createScanScheduler({
      scan,
      throttleMs: 0,
      debounceMs: 40,
    })
    const { coordinator, listeners } = createInjectedCoordinator((id) => {
      scheduler.schedule(id)
    })

    coordinator.reconcile([
      { repositoryId: 'repo-1', rootPath: '/registered/repo-1' },
    ])
    const notify = listeners.get('/registered/repo-1')
    notify?.('change', 'a.ts')
    notify?.('rename', 'b.ts')
    notify?.('change', 'c.ts')

    expect(scan).not.toHaveBeenCalled()
    expect(scheduler.pendingCount()).toBe(1)
    vi.advanceTimersByTime(39)
    expect(scan).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(scan).toHaveBeenCalledTimes(1)
    expect(scan).toHaveBeenCalledWith('repo-1')
  })

  it('fails soft for unavailable roots and watcher errors', () => {
    const watched: string[] = []
    const closed: string[] = []
    const errorListeners = new Map<string, (error: Error) => void>()
    const coordinator = trackCoordinator(
      createRepositoryWatcherCoordinator({
        schedule: vi.fn(),
        isWatchable: (rootPath) => !rootPath.includes('missing'),
        watchFn: (rootPath) => {
          if (rootPath.includes('broken')) {
            throw new Error('watch failed')
          }
          watched.push(rootPath)
          return {
            close() {
              closed.push(rootPath)
            },
            on(event, listener) {
              if (event === 'error') {
                errorListeners.set(rootPath, listener)
              }
            },
          }
        },
      }),
    )

    expect(() =>
      coordinator.reconcile([
        { repositoryId: 'missing', rootPath: '/registered/missing' },
        { repositoryId: 'broken', rootPath: '/registered/broken' },
        { repositoryId: 'ok', rootPath: '/registered/ok' },
      ]),
    ).not.toThrow()
    expect(watched).toEqual(['/registered/ok'])
    expect(coordinator.watchedRoots().map((item) => item.repositoryId)).toEqual([
      'ok',
    ])

    expect(() =>
      errorListeners.get('/registered/ok')?.(new Error('native watch error')),
    ).not.toThrow()
    expect(closed).toEqual(['/registered/ok'])
    expect(coordinator.watchedRoots()).toEqual([])
  })

  it('reconciles away unregistered roots and closes native watchers on dispose', () => {
    const directory = trackDirectory()
    const schedule = vi.fn()
    const coordinator = trackCoordinator(
      createRepositoryWatcherCoordinator({ schedule }),
    )

    coordinator.reconcile([
      { repositoryId: 'repo-1', rootPath: directory },
    ])
    expect(coordinator.watchedRoots()).toEqual([
      { repositoryId: 'repo-1', rootPath: resolve(directory) },
    ])

    coordinator.reconcile([])
    expect(coordinator.watchedRoots()).toEqual([])

    coordinator.reconcile([
      { repositoryId: 'repo-1', rootPath: directory },
    ])
    coordinator.dispose()
    expect(coordinator.watchedRoots()).toEqual([])
    coordinator.reconcile([
      { repositoryId: 'repo-1', rootPath: directory },
    ])
    expect(coordinator.watchedRoots()).toEqual([])
    expect(schedule).not.toHaveBeenCalled()
  })
})

function createInjectedCoordinator(
  schedule: (repositoryId: string) => void,
): {
  readonly coordinator: ReturnType<typeof createRepositoryWatcherCoordinator>
  readonly listeners: Map<
    string,
    (eventType: string, filename: string | Buffer | null) => void
  >
} {
  const listeners = new Map<
    string,
    (eventType: string, filename: string | Buffer | null) => void
  >()
  const coordinator = trackCoordinator(
    createRepositoryWatcherCoordinator({
      schedule,
      isWatchable: () => true,
      watchFn: (rootPath, listener) => {
        listeners.set(resolve(rootPath), listener)
        return createHandle()
      },
    }),
  )
  return { coordinator, listeners }
}

function createHandle(): RepositoryWatcherHandle {
  return {
    close() {},
  }
}

function trackCoordinator(
  coordinator: ReturnType<typeof createRepositoryWatcherCoordinator>,
): ReturnType<typeof createRepositoryWatcherCoordinator> {
  coordinators.push(coordinator)
  return coordinator
}

function trackDirectory(): string {
  const directory = join(
    tmpdir(),
    `sikumi-watcher-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(directory, { recursive: true })
  tempDirectories.push(directory)
  return directory
}
