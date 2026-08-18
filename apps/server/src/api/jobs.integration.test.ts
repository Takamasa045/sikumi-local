import { readFileSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
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

describe('job execution API', () => {
  it('keeps real providers disconnected and rejects jobs without the fake harness', async () => {
    const app = createApp()
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId: 'missing', request: '調べて' },
    })
    const providers = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers',
    })

    expect(created.statusCode).toBe(404)
    expect(created.json().error.code).toBe('NOT_FOUND')
    expect(providers.json().executionConnected).toBe(false)
    expect(
      providers
        .json()
        .providers.every(
          (provider: { id: string; executionConnected: boolean }) =>
            provider.id !== 'fake' && provider.executionConnected === false,
        ),
    ).toBe(true)

    const repositoryPath = track(createTemporaryGitRepository())
    const workspaceResponse = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repositoryPath },
    })
    const disconnectedJob = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId: workspaceResponse.json().workspace.id,
        request: '調べて',
      },
    })
    expect(disconnectedJob.statusCode).toBe(409)
    expect(disconnectedJob.json().error.code).toBe(
      'PROVIDER_EXECUTION_DISCONNECTED',
    )
  })

  it('runs UI-to-artifact flow through the fake harness only', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(dataDirectory, true)

    const workspaceResponse = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repositoryPath },
    })
    const workspaceId = workspaceResponse.json().workspace.id as string
    const created = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId, request: '構成を調べて' },
    })
    const jobId = created.json().job.id as string

    expect(created.statusCode).toBe(201)
    expect(created.json().job.selectedProvider).toBe('fake')

    const approval = await waitForJson(
      app,
      `/api/approvals?jobId=${jobId}`,
      (body) => {
        const approvals = body.approvals as Array<{
          id: string
          summary: string
        }>
        return approvals[0]
      },
    )
    const resolved = await injectAuthed(app, {
      method: 'POST',
      url: `/api/approvals/${approval.id}/resolve`,
      payload: { decision: 'approved' },
    })
    expect(resolved.statusCode).toBe(200)

    const artifact = await waitForJson(
      app,
      `/api/artifacts?jobId=${jobId}`,
      (body) => {
        const artifacts = body.artifacts as Array<{
          title: string
          storagePath: string | null
        }>
        return artifacts[0]
      },
    )
    const completed = await waitForJson(app, `/api/jobs/${jobId}`, (body) => {
      const job = body.job as { status: string }
      return job.status === 'completed' ? job : undefined
    })
    const events = await injectPublic(app, {
      method: 'GET',
      url: `/api/jobs/${jobId}/events`,
    })
    const eventTypes = (
      events.json().events as Array<{
        type: string
        payload: Record<string, unknown>
      }>
    ).map((event) => event.type)

    expect(artifact.title).toBe('調査メモ')
    expect(artifact).not.toHaveProperty('content')
    expect(artifact.storagePath).toBeNull()
    expect(completed.status).toBe('completed')
    expect(eventTypes).toContain('repository.read')
    expect(eventTypes).toContain('web.search')
    expect(eventTypes).toContain('approval.requested')
    expect(eventTypes).toContain('artifact.created')
    expect(JSON.stringify(events.json())).not.toContain(
      'INTERNAL_REASONING_MUST_NOT_PERSIST',
    )
    expect(JSON.stringify(events.json())).not.toContain('FAKE_SECRET_TOKEN')
    expect(
      readFileSync(`${dataDirectory}/database.sqlite`).includes(
        'INTERNAL_REASONING_MUST_NOT_PERSIST',
      ),
    ).toBe(false)
  })

  it('fails and cancels deterministically through the fake harness', async () => {
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(track(createTemporaryDirectory()), true)
    const workspaceId = (
      await injectAuthed(app, {
        method: 'POST',
        url: '/api/workspaces',
        payload: { path: repositoryPath },
      })
    ).json().workspace.id as string

    const failed = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId, request: 'これを[fail]させて' },
    })
    const failedJob = await waitForJson(
      app,
      `/api/jobs/${failed.json().job.id}`,
      (body) => {
        const job = body.job as { status: string }
        return job.status === 'failed' ? job : undefined
      },
    )
    expect(failedJob.status).toBe('failed')

    const hanging = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId, request: '[hang]待って' },
    })
    const cancelled = await injectAuthed(app, {
      method: 'POST',
      url: `/api/jobs/${hanging.json().job.id}/cancel`,
    })
    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json().job.status).toBe('cancelled')
    expect(cancelled.json().job.completedAt).toBeTruthy()
  })

  it('lists jobs, streams events, and serves artifacts and approval filters', async () => {
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(track(createTemporaryDirectory()), true)
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
      payload: { workspaceId, request: '構成を調べて', jobType: 'research' },
    })
    const jobId = created.json().job.id as string
    const listed = await injectPublic(app, {
      method: 'GET',
      url: `/api/jobs?workspaceId=${workspaceId}`,
    })
    const listedAll = await injectPublic(app, {
      method: 'GET',
      url: '/api/jobs',
    })
    const allApprovals = await injectPublic(app, {
      method: 'GET',
      url: '/api/approvals',
    })
    const allArtifacts = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts',
    })
    expect(listed.json().jobs[0].id).toBe(jobId)
    expect(listedAll.json().jobs.length).toBeGreaterThan(0)
    expect(Array.isArray(allApprovals.json().approvals)).toBe(true)
    expect(Array.isArray(allArtifacts.json().artifacts)).toBe(true)

    const invalidJob = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId: '', request: '' },
    })
    expect(invalidJob.statusCode).toBe(400)

    const missingJob = await injectPublic(app, {
      method: 'GET',
      url: '/api/jobs/missing',
    })
    expect(missingJob.statusCode).toBe(404)

    const approval = await waitForJson(
      app,
      `/api/approvals?jobId=${jobId}&status=pending`,
      (body) => {
        const approvals = body.approvals as Array<{ id: string }>
        return approvals[0]
      },
    )
    const invalidApproval = await injectAuthed(app, {
      method: 'POST',
      url: `/api/approvals/${approval.id}/resolve`,
      payload: { decision: 'maybe' },
    })
    expect(invalidApproval.statusCode).toBe(400)

    await injectAuthed(app, {
      method: 'POST',
      url: `/api/approvals/${approval.id}/resolve`,
      payload: { decision: 'approved' },
    })
    const artifact = await waitForJson(
      app,
      `/api/artifacts?jobId=${jobId}`,
      (body) => {
        const artifacts = body.artifacts as Array<{ id: string }>
        return artifacts[0]
      },
    )
    const fetched = await injectPublic(app, {
      method: 'GET',
      url: `/api/artifacts/${artifact.id}`,
    })
    expect(fetched.statusCode).toBe(200)
    const missingArtifact = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts/missing',
    })
    expect(missingArtifact.statusCode).toBe(404)

    const alreadyCancelled = await injectAuthed(app, {
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
    })
    expect(alreadyCancelled.statusCode).toBe(200)
  })

  it('runs two fake harness jobs concurrently without mixing approvals', async () => {
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(track(createTemporaryDirectory()), true)
    const workspaceId = (
      await injectAuthed(app, {
        method: 'POST',
        url: '/api/workspaces',
        payload: { path: repositoryPath },
      })
    ).json().workspace.id as string

    const first = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId, request: '1件目を調べて' },
    })
    const second = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId, request: '2件目を調べて' },
    })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(first.json().job.id).not.toBe(second.json().job.id)
  })

  it('denies a pending approval and marks the job failed', async () => {
    const repositoryPath = track(createTemporaryGitRepository())
    const app = createApp(track(createTemporaryDirectory()), true)
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
    const approval = await waitForJson(
      app,
      `/api/approvals?status=pending`,
      (body) => {
        const approvals = body.approvals as Array<{ id: string; jobId: string }>
        return approvals.find((item) => item.jobId === jobId)
      },
    )
    await injectAuthed(app, {
      method: 'POST',
      url: `/api/approvals/${approval.id}/resolve`,
      payload: { decision: 'denied' },
    })
    const failed = await waitForJson(app, `/api/jobs/${jobId}`, (body) => {
      const job = body.job as { status: string }
      return job.status === 'failed' ? job : undefined
    })
    expect(failed.status).toBe('failed')
  })
})

function createApp(
  dataDirectory = track(createTemporaryDirectory()),
  enableFakeProvider = false,
) {
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
  let lastBody: Record<string, unknown> = {}
  while (Date.now() < deadline) {
    const response = await injectPublic(app, { method: 'GET', url })
    lastBody = response.json() as Record<string, unknown>
    const value = pick(lastBody)
    if (value !== undefined) {
      return value
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
  throw new Error(`Timed out waiting for ${url}: ${JSON.stringify(lastBody)}`)
}
