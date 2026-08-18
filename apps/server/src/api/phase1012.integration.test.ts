import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureEmployeePackDirectory } from '@sikumi-local/employee-sdk'
import { buildApp } from '../app.js'
import { installFixtureEmployee } from '../test/fixture-employee.js'
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

describe('phase 10-12 HTTP contracts', () => {
  it('exposes growth, requires confirm for write APIs, and installs a local pack', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory, true)
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
      payload: { workspaceId, request: '調べて' },
    })
    const jobId = created.json().job.id as string
    await waitForJson(app, `/api/jobs/${jobId}`, (body) => {
      const job = body.job as { status: string }
      return job.status === 'completed' || job.status === 'waiting_for_user'
        ? job
        : undefined
    })
    const approval = await injectPublic(app, {
      method: 'GET',
      url: `/api/approvals?jobId=${jobId}`,
    })
    const pending = (approval.json().approvals as Array<{ id: string }>)[0]
    if (pending) {
      await injectAuthed(app, {
        method: 'POST',
        url: `/api/approvals/${pending.id}/resolve`,
        payload: { decision: 'approved' },
      })
    }
    await waitForJson(app, `/api/jobs/${jobId}`, (body) => {
      const job = body.job as { status: string }
      return job.status === 'completed' ? job : undefined
    })

    const growth = await injectPublic(app, {
      method: 'GET',
      url: '/api/growth',
    })
    expect(growth.statusCode).toBe(200)
    expect(
      (
        growth.json().growth as Array<{
          employeeId: string
          permissionProfile: string
        }>
      )[0]?.permissionProfile,
    ).toBe('research')
    expect(
      (
        await injectPublic(app, {
          method: 'GET',
          url: '/api/employees/saguru/growth',
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await injectPublic(app, {
          method: 'GET',
          url: `/api/workspaces/${workspaceId}/growth`,
        })
      ).statusCode,
    ).toBe(200)
    const exported = await injectPublic(app, {
      method: 'GET',
      url: '/api/growth?export=1',
    })
    expect(JSON.stringify(exported.json())).not.toContain(repositoryPath)
    expect(JSON.stringify(exported.json())).not.toContain('reasoning')

    const unconfirmed = await injectAuthed(app, {
      method: 'POST',
      url: '/api/packs/install',
      payload: { previewId: 'x' },
    })
    expect(unconfirmed.statusCode).toBe(400)

    const preview = await injectAuthed(app, {
      method: 'POST',
      url: '/api/packs/preview',
      payload: {
        sourceType: 'folder',
        path: fixtureEmployeePackDirectory('miru'),
      },
    })
    expect(preview.statusCode).toBe(201)
    expect(preview.json().preview.packId).toBe('miru')
    const installed = await injectAuthed(app, {
      method: 'POST',
      url: '/api/packs/install',
      payload: { previewId: preview.json().preview.id, confirm: true },
    })
    expect(installed.statusCode).toBe(201)
    const packs = await injectPublic(app, { method: 'GET', url: '/api/packs' })
    expect(
      (packs.json().packs as Array<{ packId: string }>).some(
        (pack) => pack.packId === 'miru',
      ),
    ).toBe(true)
    const employees = await injectPublic(app, {
      method: 'GET',
      url: '/api/employees',
    })
    expect(
      (employees.json().employees as Array<{ id: string }>).some(
        (employee) => employee.id === 'miru',
      ),
    ).toBe(true)

    const builtin = (
      packs.json().packs as Array<{ id: string; packId: string }>
    ).find((pack) => pack.packId === 'saguru')
    const blocked = await injectAuthed(app, {
      method: 'DELETE',
      url: `/api/packs/${builtin?.id}`,
      payload: { confirm: true },
    })
    expect(blocked.statusCode).toBe(403)
  })

  it('rejects escalating saguru through the createJob API', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory, true)
    const workspaceId = (
      await injectAuthed(app, {
        method: 'POST',
        url: '/api/workspaces',
        payload: { path: repositoryPath },
      })
    ).json().workspace.id as string

    const edit = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId,
        employeeId: 'saguru',
        request: '直して',
        permissionProfile: 'edit-worktree',
      },
    })
    expect(edit.statusCode).toBe(403)
    expect(edit.json().error.code).toBe('PERMISSION_ESCALATION')

    const unrestricted = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId,
        employeeId: 'saguru',
        request: '直して',
        permissionProfile: 'unrestricted',
      },
    })
    expect(unrestricted.statusCode).toBe(403)
    expect(unrestricted.json().error.code).toBe('PERMISSION_ESCALATION')

    const weaker = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId,
        employeeId: 'saguru',
        request: '調べて',
        permissionProfile: 'observe',
      },
    })
    expect(weaker.statusCode).toBe(201)
    expect(weaker.json().job.permissionProfile).toBe('research')
  })

  it('keeps write jobs off the registered tree through the HTTP API', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    installFixtureEmployee(dataDirectory, 'kakikae')
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory, true)
    const workspaceId = (
      await injectAuthed(app, {
        method: 'POST',
        url: '/api/workspaces',
        payload: { path: repositoryPath },
      })
    ).json().workspace.id as string
    writeFileSync(join(repositoryPath, 'README.md'), '# dirty\n')
    const dirty = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId,
        employeeId: 'kakikae',
        request: '直して',
      },
    })
    expect(dirty.statusCode).toBe(409)
    expect(dirty.json().error.code).toBe('WORKTREE_DIRTY_REPO')
    execFileSync('git', ['-C', repositoryPath, 'checkout', '--', 'README.md'])
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId,
        employeeId: 'kakikae',
        request: '直して',
        dirtyWorktreePolicy: 'from-head',
      },
    })
    expect(created.statusCode).toBe(201)
    const jobId = created.json().job.id as string
    try {
      const pending = await waitForJson(
        app,
        `/api/approvals?jobId=${jobId}`,
        (body) => {
          return (body.approvals as Array<{ id: string }>)[0]
        },
      )
      await injectAuthed(app, {
        method: 'POST',
        url: `/api/approvals/${pending.id}/resolve`,
        payload: { decision: 'approved' },
      })
    } catch {
      // Some write jobs finish without an approval.
    }
    await waitForJson(app, `/api/jobs/${jobId}`, (body) => {
      const job = body.job as { status: string }
      return job.status === 'completed' || job.status === 'failed'
        ? job
        : undefined
    })
    expect(readFileSync(join(repositoryPath, 'README.md'), 'utf8')).toContain(
      'fixture',
    )
    const worktree = await injectPublic(app, {
      method: 'GET',
      url: `/api/jobs/${jobId}/worktree`,
    })
    expect(worktree.statusCode).toBe(200)
    expect(worktree.json().worktree.branchName).toMatch(/^shikumi\//)
    const noConfirm = await injectAuthed(app, {
      method: 'POST',
      url: `/api/jobs/${jobId}/worktree/discard`,
      payload: {},
    })
    expect(noConfirm.statusCode).toBe(400)
    const keepDenied = await injectAuthed(app, {
      method: 'POST',
      url: `/api/jobs/${jobId}/worktree/keep`,
      payload: {},
    })
    expect(keepDenied.statusCode).toBe(400)
    const artifacts = await injectPublic(app, {
      method: 'GET',
      url: `/api/artifacts?jobId=${jobId}`,
    })
    const patch = (
      artifacts.json().artifacts as Array<{ id: string; type: string }>
    ).find((item) => item.type === 'patch')
    if (patch) {
      const applyDenied = await injectAuthed(app, {
        method: 'POST',
        url: `/api/artifacts/${patch.id}/apply`,
        payload: {},
      })
      expect(applyDenied.statusCode).toBe(400)
      const exportDenied = await injectAuthed(app, {
        method: 'POST',
        url: `/api/artifacts/${patch.id}/export`,
        payload: {},
      })
      expect(exportDenied.statusCode).toBe(400)
      const exported = await injectAuthed(app, {
        method: 'POST',
        url: `/api/artifacts/${patch.id}/export`,
        payload: { confirm: true },
      })
      expect(exported.statusCode).toBe(200)
    }
    const discard = await injectAuthed(app, {
      method: 'POST',
      url: `/api/jobs/${jobId}/worktree/discard`,
      payload: { confirm: true },
    })
    expect(discard.statusCode).toBe(200)
  })
})

function createApp(dataDirectory: string, enableFakeProvider: boolean) {
  const app = buildApp({ dataDirectory, enableFakeProvider })
  apps.push(app)
  return app
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}

async function waitForJson<T>(
  app: ReturnType<typeof buildApp>,
  url: string,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<T> {
  const deadline = Date.now() + 8_000
  let last: Record<string, unknown> = {}
  while (Date.now() < deadline) {
    const response = await injectPublic(app, { method: 'GET', url })
    last = response.json() as Record<string, unknown>
    const value = pick(last)
    if (value !== undefined) {
      return value
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 40)
    })
  }
  throw new Error(`Timed out ${url}: ${JSON.stringify(last)}`)
}
