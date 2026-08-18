import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetSessionToken } from './session.js'
import {
  cancelJob,
  createJob,
  getArtifact,
  getJob,
  listArtifacts,
  listJobEvents,
  listJobs,
} from './jobs.js'
import { listApprovals, resolveApproval } from './approvals.js'
import { getHealth } from './health.js'

afterEach(() => {
  resetSessionToken()
  vi.unstubAllGlobals()
})

describe('job API clients', () => {
  it('creates a job and reads events, approvals, and artifacts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        if (url.endsWith('/api/jobs') && init?.method === 'POST') {
          return jsonResponse({ job: sampleJob() }, 201)
        }
        if (url.endsWith('/api/jobs') && init?.method !== 'POST') {
          return jsonResponse({ jobs: [sampleJob()] })
        }
        if (url.endsWith('/api/jobs?workspaceId=ws_1')) {
          return jsonResponse({ jobs: [sampleJob()] })
        }
        if (url.endsWith('/api/jobs/job_1') && init?.method !== 'POST') {
          return jsonResponse({ job: sampleJob() })
        }
        if (url.endsWith('/api/jobs/job_1/cancel')) {
          return jsonResponse({ job: { ...sampleJob(), status: 'cancelled' } })
        }
        if (url.endsWith('/api/artifacts/art_1')) {
          return jsonResponse({
            artifact: {
              id: 'art_1',
              jobId: 'job_1',
              type: 'report',
              title: '調査メモ',
              storagePath: null,
              createdAt: 't',
            },
          })
        }
        if (url.endsWith('/api/artifacts')) {
          return jsonResponse({ artifacts: [] })
        }
        if (url.endsWith('/api/jobs/job_1/events')) {
          return jsonResponse({
            events: [
              {
                id: 'evt_1',
                jobId: 'job_1',
                runId: 'run_1',
                type: 'run.started',
                payload: { summary: '仕事を始めます' },
                occurredAt: 't',
              },
            ],
          })
        }
        if (url.endsWith('/api/approvals?status=pending')) {
          return jsonResponse({ approvals: [] })
        }
        if (url.endsWith('/api/approvals/apr_1/resolve')) {
          return jsonResponse({
            approval: {
              id: 'apr_1',
              jobId: 'job_1',
              runId: 'run_1',
              risk: 'medium',
              summary: '外部サイトへアクセスします',
              status: 'approved',
              createdAt: 't',
              resolvedAt: 't',
            },
          })
        }
        if (url.endsWith('/api/artifacts?jobId=job_1')) {
          return jsonResponse({
            artifacts: [
              {
                id: 'art_1',
                jobId: 'job_1',
                type: 'report',
                title: '調査メモ',
                storagePath: null,
                createdAt: 't',
              },
            ],
          })
        }
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404)
      }),
    )

    await expect(
      createJob({ workspaceId: 'ws_1', request: '調べて' }),
    ).resolves.toMatchObject({ selectedProvider: 'fake' })
    await expect(listJobEvents('job_1')).resolves.toHaveLength(1)
    await expect(listApprovals({ status: 'pending' })).resolves.toEqual([])
    await expect(resolveApproval('apr_1', 'approved')).resolves.toMatchObject({
      status: 'approved',
    })
    await expect(listArtifacts('job_1')).resolves.toMatchObject([
      { title: '調査メモ' },
    ])
    await expect(listJobs()).resolves.toHaveLength(1)
    await expect(listJobs('ws_1')).resolves.toHaveLength(1)
    await expect(getJob('job_1')).resolves.toMatchObject({ id: 'job_1' })
    await expect(cancelJob('job_1')).resolves.toMatchObject({
      status: 'cancelled',
    })
    await expect(getArtifact('art_1')).resolves.toMatchObject({
      title: '調査メモ',
    })
    await expect(listArtifacts()).resolves.toEqual([])
  })

  it('surfaces API failures from job and artifact endpoints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'missing' } },
          404,
        )
      }),
    )

    await expect(
      createJob({ workspaceId: 'ws', request: 'x' }),
    ).rejects.toBeInstanceOf(Error)
    await expect(getJob('missing')).rejects.toBeInstanceOf(Error)
    await expect(listJobs()).rejects.toBeInstanceOf(Error)
    await expect(listJobEvents('missing')).rejects.toBeInstanceOf(Error)
    await expect(cancelJob('missing')).rejects.toBeInstanceOf(Error)
    await expect(listArtifacts('missing')).rejects.toBeInstanceOf(Error)
    await expect(getArtifact('missing')).rejects.toBeInstanceOf(Error)
    await expect(listApprovals({ jobId: 'x' })).rejects.toBeInstanceOf(Error)
    await expect(resolveApproval('x', 'denied')).rejects.toBeInstanceOf(Error)
  })
})

describe('provider client', () => {
  it('lists catalog providers and probes one engine', async () => {
    const { listProviders, probeProvider } = await import('./providers.js')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        if (url.endsWith('/api/providers') && init?.method !== 'POST') {
          return jsonResponse({
            providers: [
              { id: 'codex', displayName: 'Codex', executionConnected: false },
            ],
            executionConnected: false,
            fakeHarness: false,
          })
        }
        if (url.endsWith('/api/providers/codex/probe')) {
          return jsonResponse({
            id: 'codex',
            probe: {
              installed: true,
              authenticated: false,
              transport: 'app-server',
              warnings: [],
              errors: [],
              version: '0.144.6',
            },
          })
        }
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404)
      }),
    )
    await expect(listProviders()).resolves.toMatchObject({
      executionConnected: false,
    })
    await expect(probeProvider('codex')).resolves.toMatchObject({
      probe: { installed: true },
    })
  })
})

describe('health client', () => {
  it('reads the fake harness flag without treating engines as connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          product: 'Shikumi Local',
          phase: 'provider-adapters',
          bind: '127.0.0.1',
          persistence: 'sqlite',
          providerExecution: 'disconnected',
          fakeHarness: true,
          liveProviderRuns: false,
        }),
      ),
    )

    await expect(getHealth()).resolves.toMatchObject({
      providerExecution: 'disconnected',
      fakeHarness: true,
    })
  })

  it('maps a failed health response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'NOT_FOUND', message: 'down' } }, 404),
      ),
    )
    await expect(getHealth()).rejects.toBeInstanceOf(Error)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sampleJob() {
  return {
    id: 'job_1',
    workspaceId: 'ws_1',
    employeeId: 'saguru',
    request: '調べて',
    jobType: 'research',
    selectedProvider: 'fake',
    selectedModel: null,
    permissionProfile: 'research',
    status: 'running',
    providerSessionId: null,
    createdAt: 't',
    startedAt: 't',
    completedAt: null,
  }
}
