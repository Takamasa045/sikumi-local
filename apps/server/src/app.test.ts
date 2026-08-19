import { existsSync, readFileSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from './test/git-fixture.js'
import { injectAuthed, injectPublic } from './test/http.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('local server', () => {
  it('reports a local-only health contract for domain persistence', async () => {
    const app = createApp()

    const response = await injectPublic(app, {
      method: 'GET',
      url: '/api/health',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      product: 'Shikumi Local',
      phase: 'employee-garden',
      bind: '127.0.0.1',
      persistence: 'sqlite',
      providerExecution: 'disconnected',
      fakeHarness: false,
      liveProviderRuns: false,
    })
  })

  it('does not expose a generic root API response', async () => {
    const app = createApp()

    const response = await injectPublic(app, { method: 'GET', url: '/' })

    expect(response.statusCode).toBe(404)
  })

  it('keeps every provider disconnected', async () => {
    const app = createApp()

    const response = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      executionConnected: false,
      fakeHarness: false,
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          executionConnected: false,
          installed: false,
          authenticated: false,
          status: 'not_installed',
          capabilities: [],
        },
        {
          id: 'grok-build',
          displayName: 'Grok Build',
          executionConnected: false,
          installed: false,
          authenticated: false,
          status: 'not_installed',
          capabilities: [],
        },
        {
          id: 'claude-code',
          displayName: 'Claude Code',
          executionConnected: false,
          installed: false,
          authenticated: false,
          status: 'not_installed',
          capabilities: [],
        },
      ],
    })
  })

  it('registers a real local Git repository and keeps it after restart', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repositoryPath = track(
      createTemporaryGitRepository({
        remoteUrl:
          'https://user:ghs_super_secret@github.com/example/workshop.git',
      }),
    )

    const first = createApp(dataDirectory)
    const created = await injectAuthed(first, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repositoryPath },
    })

    expect(created.statusCode).toBe(201)
    const workspace = created.json().workspace as {
      id: string
      name: string
      repository: { remoteUrl: string; currentBranch: string }
    }
    expect(workspace.name.length).toBeGreaterThan(0)
    expect(workspace.repository.currentBranch).toBe('main')
    expect(workspace.repository.remoteUrl).toBe(
      'https://github.com/example/workshop.git',
    )
    expect(
      readFileSync(`${dataDirectory}/database.sqlite`).includes(
        'ghs_super_secret',
      ),
    ).toBe(false)
    await first.close()

    const second = createApp(dataDirectory)
    const listed = await injectPublic(second, {
      method: 'GET',
      url: '/api/workspaces',
    })
    const fetched = await injectPublic(second, {
      method: 'GET',
      url: `/api/workspaces/${workspace.id}`,
    })

    expect(listed.json().workspaces).toHaveLength(1)
    expect(fetched.statusCode).toBe(200)
    expect(fetched.json().workspace.id).toBe(workspace.id)
    expect(fetched.json().workspace.repository.absolutePath).toBe(
      repositoryPath,
    )
  })

  it('unregisters a place without deleting the folder on disk', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory)

    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repositoryPath },
    })
    const workspace = created.json().workspace as { id: string }
    expect(created.statusCode).toBe(201)

    const removed = await injectAuthed(app, {
      method: 'DELETE',
      url: `/api/workspaces/${workspace.id}`,
    })
    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/workspaces',
    })
    const missing = await injectPublic(app, {
      method: 'GET',
      url: `/api/workspaces/${workspace.id}`,
    })
    const unknown = await injectAuthed(app, {
      method: 'DELETE',
      url: '/api/workspaces/missing',
    })

    expect(removed.statusCode).toBe(200)
    expect(removed.json()).toEqual({ ok: true })
    expect(listed.json().workspaces).toEqual([])
    expect(missing.statusCode).toBe(404)
    expect(unknown.statusCode).toBe(404)
    expect(existsSync(repositoryPath)).toBe(true)
    expect(existsSync(`${repositoryPath}/.git`)).toBe(true)
    expect(
      readFileSync(
        `${dataDirectory}/observer/registered-repositories.json`,
        'utf8',
      ),
    ).toContain('"repositories": []')
    expect(basename(repositoryPath).length).toBeGreaterThan(0)
  })

  it('does not open a native folder picker on unsupported platforms', async () => {
    const app = createApp()
    const response = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces/choose-folder',
    })

    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect([200, 400]).toContain(response.statusCode)
      return
    }
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('FOLDER_PICKER_UNAVAILABLE')
  })

  it('rejects path traversal, missing paths, non-git paths, and duplicates', async () => {
    const app = createApp()
    const repositoryPath = track(createTemporaryGitRepository())

    const traversal = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: '/tmp/safe/../secret' },
    })
    const missing = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: '/tmp/sikumi-does-not-exist' },
    })
    const notGit = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: createTemporaryDirectory() },
    })
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repositoryPath },
    })
    const duplicate = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repositoryPath },
    })
    const invalid = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: '' },
    })
    const unknown = await injectPublic(app, {
      method: 'GET',
      url: '/api/workspaces/missing',
    })

    expect(traversal.json().error.code).toBe('PATH_TRAVERSAL')
    expect(missing.json().error.code).toBe('REPOSITORY_NOT_FOUND')
    expect(notGit.json().error.code).toBe('REPOSITORY_NOT_GIT')
    expect(created.statusCode).toBe(201)
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error.code).toBe('REPOSITORY_DUPLICATE')
    expect(invalid.statusCode).toBe(400)
    expect(unknown.statusCode).toBe(404)
  })

  it('redacts secrets in AppError API responses', async () => {
    const app = createApp()
    const response = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId: 'missing',
        request: '調べて TOKEN=sk-live-secret-value',
      },
    })

    expect(response.statusCode).toBe(404)
    expect(JSON.stringify(response.json())).not.toContain(
      'sk-live-secret-value',
    )
    expect(response.json().error.message).toBe('Workspaceが見つかりません')
  })
})

function createApp(dataDirectory = track(createTemporaryDirectory())) {
  const app = buildApp({ dataDirectory })
  apps.push(app)
  return app
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
