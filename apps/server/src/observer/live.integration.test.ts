import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { createObserverService } from './service.js'

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

describe('live discovery without hooks', () => {
  it('marks a registered place as working when Codex is running there', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const repo = track(createTemporaryGitRepository())
    const workspace = store.createWorkspace({
      absolutePath: repo,
      displayName: 'blog',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 0,
        liveHomeDir: track(createTemporaryDirectory()),
        liveCurrentUser: 'mei',
        listLiveProcesses: () => [
          {
            pid: 42,
            user: 'mei',
            command: 'codex',
            args: 'codex',
            cwd: repo,
          },
        ],
      }),
    )
    await service.recover()

    const overview = service.today()
    const repository = overview.repositories.find(
      (item) => item.repositoryId === workspace.repository.id,
    )
    const session = repository?.sessions.find((item) => item.source === 'codex')
    expect(session).toMatchObject({
      source: 'codex',
      status: 'active',
      attributionConfidence: 'verified',
    })
    expect(session?.title).not.toBe('変更元不明の作業')
    expect(
      store.listAdapters().find((adapter) => adapter.source === 'codex')
        ?.lastEventAt,
    ).toBeNull()
  })

  it('does not turn git-only changes into a live AI session', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const repo = track(createTemporaryGitRepository())
    store.createWorkspace({
      absolutePath: repo,
      displayName: 'notes',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 0,
        liveHomeDir: track(createTemporaryDirectory()),
        liveCurrentUser: 'mei',
        listLiveProcesses: () => [],
      }),
    )
    await service.recover()
    const overview = service.today()
    expect(
      overview.repositories[0]?.sessions.every(
        (session) => session.source === 'git',
      ) ?? true,
    ).toBe(true)
    expect(
      overview.repositories[0]?.sessions.some(
        (session) => session.source === 'codex',
      ),
    ).toBe(false)
  })
})

function openIsolatedStore(): {
  readonly store: ReturnType<typeof createStore>
  readonly dataDirectory: string
} {
  const dataDirectory = track(createTemporaryDirectory())
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  return {
    store: createStore(opened.db),
    dataDirectory,
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
