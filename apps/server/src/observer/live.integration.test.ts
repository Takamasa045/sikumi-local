import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
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

  it('does not bind Codex Desktop at / through an older same-leaf checkout of another repo', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const registered = track(
      createTemporaryGitRepository({
        remoteUrl: 'https://github.com/example/hataraki.git',
      }),
    )
    writePackageName(registered, 'hataraki')
    store.createWorkspace({
      absolutePath: registered,
      displayName: 'hataraki',
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/hataraki.git',
      readable: true,
    })
    const live = writeIdentifiedTwin(registered, {
      packageName: 'sikumi-local',
      remoteUrl: 'https://github.com/Takamasa045/sikumi-local.git',
    })
    const home = track(createTemporaryDirectory())
    writeCodexRollout(home, live, 'sess-other', Date.now() - 15_000)

    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 0,
        liveHomeDir: home,
        liveCurrentUser: 'mei',
        listLiveProcesses: () => [
          {
            pid: 77,
            user: 'mei',
            command: 'ChatGPT',
            args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
            cwd: '/',
          },
        ],
      }),
    )
    await service.recover()

    const overview = service.today()
    expect(
      overview.repositories[0]?.sessions.some(
        (session) => session.source === 'codex',
      ),
    ).toBe(false)
  })

  it('marks a registered place as working from a huge Codex Desktop session file', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const repo = track(createTemporaryGitRepository())
    const workspace = store.createWorkspace({
      absolutePath: repo,
      displayName: 'hataraki',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    const home = track(createTemporaryDirectory())
    writeCodexRollout(home, repo, 'sess-huge-desktop', Date.now() - 15_000, {
      originator: 'Codex Desktop',
      clientSource: 'vscode',
      firstLineBytes: 48_000,
    })

    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 0,
        liveHomeDir: home,
        liveCurrentUser: 'mei',
        listLiveProcesses: () => [
          {
            pid: 88,
            user: 'mei',
            command: 'ChatGPT',
            args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
            cwd: '/',
            childCwds: ['/', '/tmp', '/Users/takamasa'],
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
      surface: 'desktop-app',
      status: 'active',
    })
    expect(session?.title).not.toBe('変更元不明の作業')
  })

  it('binds Codex Desktop at / to a registered place via a same-repo twin session', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const registered = track(
      createTemporaryGitRepository({
        remoteUrl: 'https://github.com/example/hataraki.git',
      }),
    )
    writePackageName(registered, 'hataraki')
    const workspace = store.createWorkspace({
      absolutePath: registered,
      displayName: 'hataraki',
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/hataraki.git',
      readable: true,
    })
    const live = writeIdentifiedTwin(registered, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    const home = track(createTemporaryDirectory())
    writeCodexRollout(home, live, 'sess-hataraki', Date.now() - 15_000)

    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 0,
        liveHomeDir: home,
        liveCurrentUser: 'mei',
        listLiveProcesses: () => [
          {
            pid: 77,
            user: 'mei',
            command: 'ChatGPT',
            args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
            cwd: '/',
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
    })
    expect(session?.title).not.toBe('変更元不明の作業')
    expect(
      store.listAdapters().find((adapter) => adapter.source === 'codex')
        ?.lastEventAt,
    ).toBeNull()
  })

  it('keeps grok --cwd hataraki and a second grok at tsugite both active', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const hataraki = track(createTemporaryGitRepository())
    const tsugite = track(createTemporaryGitRepository())
    const launch = track(createTemporaryDirectory())
    const hatarakiWorkspace = store.createWorkspace({
      absolutePath: hataraki,
      displayName: 'hataraki',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    const tsugiteWorkspace = store.createWorkspace({
      absolutePath: tsugite,
      displayName: 'tsugite',
      currentBranch: 'main',
      remoteName: null,
      remoteUrl: null,
      readable: true,
    })
    store.upsertExternalSession({
      id: 'sess-hataraki-stale',
      source: 'grok-build',
      surface: 'cli',
      externalSessionId: `live:grok-build:${hatarakiWorkspace.repository.id}`,
      workspaceId: hatarakiWorkspace.id,
      repositoryId: hatarakiWorkspace.repository.id,
      cwd: hataraki,
      worktreePath: hataraki,
      branch: null,
      baseCommit: null,
      headCommit: null,
      title: '作業中',
      status: 'stale',
      activity: 'editing',
      attributionConfidence: 'verified',
      startedAt: '2026-08-18T00:00:00.000Z',
      lastObservedAt: '2026-08-18T00:00:00.000Z',
      endedAt: null,
    })

    const service = trackService(
      createObserverService(store, dataDirectory, {
        consistencyIntervalMs: 0,
        liveHomeDir: track(createTemporaryDirectory()),
        liveCurrentUser: 'mei',
        listLiveProcesses: () => [
          {
            pid: 81,
            user: 'mei',
            command: 'grok',
            args: `grok --cwd ${hataraki}`,
            cwd: launch,
          },
          {
            pid: 82,
            user: 'mei',
            command: 'grok',
            args: 'grok',
            cwd: tsugite,
          },
        ],
      }),
    )
    await service.recover()

    const overview = service.today()
    const hatarakiRepo = overview.repositories.find(
      (item) => item.repositoryId === hatarakiWorkspace.repository.id,
    )
    const tsugiteRepo = overview.repositories.find(
      (item) => item.repositoryId === tsugiteWorkspace.repository.id,
    )
    expect(
      hatarakiRepo?.sessions.find((item) => item.source === 'grok-build'),
    ).toMatchObject({
      source: 'grok-build',
      status: 'active',
    })
    expect(
      tsugiteRepo?.sessions.find((item) => item.source === 'grok-build'),
    ).toMatchObject({
      source: 'grok-build',
      status: 'active',
    })
  })

  it('keeps two live grok processes at the same registered folder as two sessions', async () => {
    const { store, dataDirectory } = openIsolatedStore()
    const tsugite = track(createTemporaryGitRepository())
    const workspace = store.createWorkspace({
      absolutePath: tsugite,
      displayName: 'tsugite',
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
            pid: 248,
            user: 'mei',
            command: 'grok',
            args: 'grok',
            cwd: tsugite,
          },
          {
            pid: 26794,
            user: 'mei',
            command: 'grok',
            args: 'grok',
            cwd: tsugite,
          },
          {
            pid: 99,
            user: 'mei',
            command: 'fake-claude',
            args: 'fake-claude',
            cwd: tsugite,
          },
        ],
      }),
    )
    await service.recover()

    const overview = service.today()
    const repository = overview.repositories.find(
      (item) => item.repositoryId === workspace.repository.id,
    )
    const groks = repository?.sessions.filter(
      (item) => item.source === 'grok-build' && item.status === 'active',
    )
    expect(groks).toHaveLength(2)
    expect(
      repository?.sessions.some((item) => item.source === 'claude-code'),
    ).toBe(false)
    expect(
      store
        .listExternalSessions({ repositoryId: workspace.repository.id })
        .map((session) => session.externalSessionId)
        .filter((id): id is string => Boolean(id)),
    ).toEqual(
      expect.arrayContaining([
        `live:grok-build:${workspace.repository.id}:pid:248`,
        `live:grok-build:${workspace.repository.id}:pid:26794`,
      ]),
    )
  })
})

function writeCodexRollout(
  home: string,
  cwd: string,
  id: string,
  mtime: number,
  extras: {
    readonly originator?: string
    readonly clientSource?: string
    readonly firstLineBytes?: number
  } = {},
) {
  const folder = join(home, '.codex', 'sessions', '2026', '08', '19')
  mkdirSync(folder, { recursive: true })
  const file = join(folder, `rollout-${id}.jsonl`)
  writeFileSync(
    file,
    `${JSON.stringify({
      type: 'session_meta',
      payload: {
        id,
        cwd,
        ...(extras.originator ? { originator: extras.originator } : {}),
        ...(extras.clientSource ? { source: extras.clientSource } : {}),
        ...(extras.firstLineBytes
          ? { base_instructions: 'X'.repeat(extras.firstLineBytes) }
          : {}),
      },
    })}\n`,
  )
  const at = new Date(mtime)
  utimesSync(file, at, at)
}

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

function writePackageName(directory: string, name: string): void {
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name })}\n`,
  )
}

function writeIdentifiedTwin(
  registered: string,
  identity: { readonly packageName: string; readonly remoteUrl: string },
): string {
  const live = join(dirname(registered), '*開発', basename(registered))
  mkdirSync(live, { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: live })
  writePackageName(live, identity.packageName)
  execFileSync('git', ['remote', 'add', 'origin', identity.remoteUrl], {
    cwd: live,
  })
  tempDirectories.push(dirname(live))
  return live
}
