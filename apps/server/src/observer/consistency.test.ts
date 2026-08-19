import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listInboxFiles,
  writeSpoolEvent,
} from '@sikumi-local/observer-bridge'
import {
  OBSERVER_STALE_AFTER_MS,
  projectInboundEvent,
} from '@sikumi-local/observer-core'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { createObserverService } from './service.js'
import type { RepositoryWatcherHandle } from './repository-watcher.js'

const tempDirectories: string[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []
const services: Array<ReturnType<typeof createObserverService>> = []

afterEach(() => {
  for (const service of services.splice(0)) {
    service.dispose()
  }
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('observer watcher and consistency tick', () => {
  it('schedules a Git rescan from a watcher event without asserting state itself', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const repo = track(createTemporaryGitRepository())
    const workspace = store.createWorkspace({
      absolutePath: repo,
      displayName: 'watched',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    const listeners = new Map<
      string,
      (eventType: string, filename: string | Buffer | null) => void
    >()
    const scheduled: Array<() => void> = []
    const service = trackService(
      createObserverService(store, dataDirectory, {
        scanThrottleMs: 0,
        scanDebounceMs: 25,
        consistencyIntervalMs: 0,
        watchFn: (rootPath, listener) => {
          listeners.set(rootPath, listener)
          return createHandle()
        },
        setTimeoutFn: ((fn: () => void) => {
          scheduled.push(fn)
          return { unref() {} } as unknown as NodeJS.Timeout
        }) as typeof setTimeout,
        clearTimeoutFn: ((handle: { cleared?: boolean }) => {
          handle.cleared = true
        }) as typeof clearTimeout,
      }),
    )
    await service.recover()
    const before = store.latestSnapshotsByRepository(workspace.repository.id)
    const beforeIds = before.map((item) => item.id)

    writeFileSync(join(repo, 'from-watch.txt'), 'changed\n')
    listeners.get(repo)?.('change', 'from-watch.txt')

    expect(store.latestSnapshotsByRepository(workspace.repository.id).map((item) => item.id)).toEqual(
      beforeIds,
    )
    expect(scheduled).toHaveLength(1)

    scheduled[0]?.()
    const after = store.latestSnapshotsByRepository(workspace.repository.id)
    expect(after.some((item) => !beforeIds.includes(item.id))).toBe(true)
    expect(
      after.some((item) =>
        (item.changedFiles as Array<{ path: string }>).some(
          (file) => file.path === 'from-watch.txt',
        ),
      ),
    ).toBe(true)
  })

  it('watches only registered repository roots', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const registered = track(createTemporaryGitRepository())
    const outsider = track(createTemporaryDirectory())
    store.createWorkspace({
      absolutePath: registered,
      displayName: 'registered',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    const watched: string[] = []
    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 0,
        watchFn: (rootPath) => {
          watched.push(rootPath)
          return createHandle()
        },
      }),
    )
    await service.recover()

    expect(watched).toEqual([registered])
    expect(watched).not.toContain(outsider)
    expect(watched.some((path) => path === join(registered, '..'))).toBe(false)
  })

  it('fails soft when a registered root is missing or watch throws', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const ok = track(createTemporaryGitRepository())
    const broken = track(createTemporaryGitRepository())
    const missing = join(track(createTemporaryDirectory()), 'gone')
    store.createWorkspace({
      absolutePath: ok,
      displayName: 'ok',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    store.createWorkspace({
      absolutePath: broken,
      displayName: 'broken',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    store.createWorkspace({
      absolutePath: missing,
      displayName: 'missing',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    const watched: string[] = []
    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 0,
        watchFn: (rootPath) => {
          if (rootPath === broken) {
            throw new Error('cannot watch broken root')
          }
          watched.push(rootPath)
          return createHandle()
        },
      }),
    )

    expect(() => service.today()).not.toThrow()
    expect(watched).toEqual([ok])
    expect(service.today().repositories).toHaveLength(3)
  })

  it('drains a spool backlog across bounded consistency ticks', () => {
    const { store, dataDirectory } = openIsolatedStore()
    mkdirSync(join(dataDirectory, 'observer/inbox/codex'), { recursive: true })
    for (let index = 0; index < 3; index += 1) {
      writeSpoolEvent(
        dataDirectory,
        projectInboundEvent({
          source: 'codex',
          nativeEventType: 'heartbeat',
          session_id: `backlog-${index}`,
          occurredAt: `2026-08-18T08:00:0${index}.000Z`,
        }),
      )
    }
    const ticks: Array<() => void> = []
    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 15,
        maxSpoolFilesPerSweep: 1,
        maxSpoolEventsPerSweep: 1,
        setIntervalFn: ((fn: () => void) => {
          ticks.push(fn)
          return { unref() {} } as unknown as NodeJS.Timeout
        }) as typeof setInterval,
        clearIntervalFn: ((handle: { cleared?: boolean }) => {
          handle.cleared = true
        }) as typeof clearInterval,
      }),
    )

    expect(listInboxFiles(dataDirectory)).toHaveLength(2)
    expect(store.listExternalSessions()).toHaveLength(1)

    ticks[0]?.()
    expect(listInboxFiles(dataDirectory)).toHaveLength(1)
    expect(store.listExternalSessions()).toHaveLength(2)

    ticks[0]?.()
    expect(listInboxFiles(dataDirectory)).toHaveLength(0)
    expect(store.listExternalSessions()).toHaveLength(3)
    expect(
      store
        .listExternalSessions()
        .map((session) => session.externalSessionId)
        .sort(),
    ).toEqual(['backlog-0', 'backlog-1', 'backlog-2'])

    service.acceptEvent({
      source: 'codex',
      nativeEventType: 'SessionStart',
      session_id: 'stale-on-tick',
      occurredAt: new Date(Date.now() - OBSERVER_STALE_AFTER_MS - 1_000).toISOString(),
    })
    expect(
      store
        .listExternalSessions()
        .find((session) => session.externalSessionId === 'stale-on-tick')
        ?.status,
    ).toBe('active')
    ticks[0]?.()
    expect(
      store
        .listExternalSessions()
        .find((session) => session.externalSessionId === 'stale-on-tick')
        ?.status,
    ).toBe('stale')
  })

  it('cancels watcher and timer on dispose so later callbacks do not touch a closed DB', async () => {
    const { store, dataDirectory, opened } = openIsolatedStore()
    const repo = track(createTemporaryGitRepository())
    store.createWorkspace({
      absolutePath: repo,
      displayName: 'closed',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    let tick: (() => void) | undefined
    let listener:
      | ((eventType: string, filename: string | Buffer | null) => void)
      | undefined
    let closedWatchers = 0
    let clearedTimers = 0
    const scheduled: Array<() => void> = []
    const service = trackService(
      createObserverService(store, dataDirectory, {
        scanDebounceMs: 20,
        consistencyIntervalMs: 30,
        watchFn: (_rootPath, nextListener) => {
          listener = nextListener
          return {
            close() {
              closedWatchers += 1
            },
          } satisfies RepositoryWatcherHandle
        },
        setIntervalFn: ((fn: () => void) => {
          tick = fn
          return { unref() {} } as unknown as NodeJS.Timeout
        }) as typeof setInterval,
        clearIntervalFn: (() => {
          clearedTimers += 1
        }) as typeof clearInterval,
        setTimeoutFn: ((fn: () => void) => {
          scheduled.push(fn)
          return { unref() {} } as unknown as NodeJS.Timeout
        }) as typeof setTimeout,
        clearTimeoutFn: (() => undefined) as typeof clearTimeout,
      }),
    )
    await service.recover()
    service.dispose()
    opened.sqlite.close()
    databases.splice(databases.indexOf(opened), 1)

    expect(closedWatchers).toBeGreaterThan(0)
    expect(clearedTimers).toBeGreaterThan(0)
    expect(() => tick?.()).not.toThrow()
    expect(() => listener?.('change', 'late.txt')).not.toThrow()
    expect(() => scheduled[0]?.()).not.toThrow()
  })
})

function openIsolatedStore(): {
  readonly store: ReturnType<typeof createStore>
  readonly dataDirectory: string
  readonly opened: ReturnType<typeof openDatabase>
} {
  const dataDirectory = track(createTemporaryDirectory())
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  return {
    store: createStore(opened.db),
    dataDirectory,
    opened,
  }
}

function trackService(
  service: ReturnType<typeof createObserverService>,
): ReturnType<typeof createObserverService> {
  services.push(service)
  return service
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}

function createHandle(): RepositoryWatcherHandle {
  return {
    close() {},
  }
}
