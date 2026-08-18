import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureEmployeePackDirectory } from '@sikumi-local/employee-sdk'
import { buildApp } from '../app.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { injectAuthed, injectPublic } from '../test/http.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('employee registry API', () => {
  it('loads saguru from the built-in pack and updates its default tool', async () => {
    const app = createApp()
    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/employees',
    })
    const saguru = (
      listed.json().employees as Array<{
        id: string
        name: string
        source: string
      }>
    ).find((employee) => employee.id === 'saguru')

    expect(listed.statusCode).toBe(200)
    expect(saguru).toMatchObject({
      id: 'saguru',
      name: 'サグル',
      source: 'builtin',
    })

    const detail = await injectPublic(app, {
      method: 'GET',
      url: '/api/employees/saguru',
    })
    expect(detail.json().employee.role).toBe('調査担当')
    expect(detail.json().stateMap.eventBindings['web.search']).toBe(
      'searching_web',
    )

    const updated = await injectAuthed(app, {
      method: 'PATCH',
      url: '/api/employees/saguru',
      payload: { defaultProviderId: 'codex' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().employee.defaultProviderId).toBe('codex')

    const invalid = await injectAuthed(app, {
      method: 'PATCH',
      url: '/api/employees/saguru',
      payload: { defaultProviderId: 'not-a-provider' },
    })
    expect(invalid.statusCode).toBe(400)
  })

  it('lists a second fixture pack after it is copied into app data, without Core changes', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = createApp(dataDirectory)
    cpSync(
      fixtureEmployeePackDirectory('miru'),
      `${dataDirectory}/employees/miru`,
      { recursive: true },
    )

    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/employees',
    })
    const ids = (
      listed.json().employees as Array<{ id: string; name: string }>
    ).map((employee) => employee.id)

    expect(ids).toContain('saguru')
    expect(ids).toContain('miru')
    expect(
      (listed.json().employees as Array<{ id: string; name: string }>).find(
        (employee) => employee.id === 'miru',
      )?.name,
    ).toBe('ミル')

    const repositoryPath = track(createTemporaryGitRepository())
    const workspaceId = (
      await injectAuthed(app, {
        method: 'POST',
        url: '/api/workspaces',
        payload: { path: repositoryPath },
      })
    ).json().workspace.id as string

    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId,
        employeeId: 'miru',
        jobType: 'watch',
        request: '変化を見て',
      },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().job.employeeId).toBe('miru')
    expect(created.json().job.jobType).toBe('watch')

    const unsupported = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId,
        employeeId: 'miru',
        jobType: 'research',
        request: '調べて',
      },
    })
    expect(unsupported.statusCode).toBe(400)
    expect(unsupported.json().error.code).toBe('UNSUPPORTED_JOB_TYPE')
  })

  it('does not load installed packs when employees root is a symlink outside the data directory', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const outside = track(createTemporaryDirectory())
    mkdirSync(`${dataDirectory}/placeholder`)
    cpSync(fixtureEmployeePackDirectory('miru'), `${outside}/miru`, {
      recursive: true,
    })
    symlinkSync(outside, `${dataDirectory}/employees`)
    const app = createApp(dataDirectory)

    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/employees',
    })
    const ids = (listed.json().employees as Array<{ id: string }>).map(
      (employee) => employee.id,
    )

    expect(listed.statusCode).toBe(200)
    expect(ids).toContain('saguru')
    expect(ids).not.toContain('miru')
  })
})

function createApp(dataDirectory = track(createTemporaryDirectory())) {
  const app = buildApp({
    dataDirectory,
    enableFakeProvider: true,
  })
  apps.push(app)
  return app
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
