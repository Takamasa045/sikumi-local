import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import type { AgentProviderAdapter } from '@sikumi-local/provider-sdk'
import { createProviderRunHandle } from '@sikumi-local/provider-sdk'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { createJobManager } from './job-manager.js'

const tempDirectories: string[] = []
const managers: Array<ReturnType<typeof createJobManager>> = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('employee registry selection', () => {
  it('creates a job for the registry employee and rejects an unsupported job type', async () => {
    const { manager, workspaceId } = openManager()
    const job = await manager.createJob({
      workspaceId,
      request: '調べて',
      employeeId: 'saguru',
      jobType: 'research',
    })
    expect(job.employeeId).toBe('saguru')
    await expect(
      manager.createJob({
        workspaceId,
        request: '調べて',
        employeeId: 'saguru',
        jobType: 'not-a-job',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNSUPPORTED_JOB_TYPE',
    })
  })
})

describe('provider selection and restart orphaning', () => {
  it('does not auto-fallback from an unavailable selected provider', async () => {
    const { manager, store, workspaceId } = openManager()
    store.updateWorkspace(workspaceId, { defaultProviderId: 'codex' })

    await expect(
      manager.createJob({
        workspaceId,
        request: '調べて',
        selectedProvider: 'claude-code',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'PROVIDER_UNAVAILABLE',
    })
  })

  it('marks leftover running jobs as failed and runs as orphaned', async () => {
    const { store, workspaceId } = openManager()
    const job = store.insertJob({
      id: 'stale-job',
      workspaceId,
      employeeId: store.ensureDefaultEmployee().id,
      request: '古い仕事',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'running',
      providerSessionId: 'thread-old',
      createdAt: 't',
      startedAt: 't',
      completedAt: null,
    })
    store.insertRun({
      id: 'stale-run',
      jobId: job.id,
      providerId: 'fake',
      status: 'running',
      createdAt: 't',
      startedAt: 't',
      completedAt: null,
    })
    store.insertProviderSession({
      id: 'stale-session',
      providerId: 'fake',
      providerSessionId: 'thread-old',
      workspaceId,
      employeeId: job.employeeId,
      jobId: job.id,
      cwd: '/tmp',
      status: 'active',
      createdAt: 't',
      updatedAt: 't',
    })

    const again = openManagerWithStore(store)
    expect(again.store.getJob(job.id)?.status).toBe('failed')
    expect(again.store.getRun('stale-run')?.status).toBe('orphaned')
    expect(again.store.listProviderSessions(job.id)[0]?.status).toBe('orphaned')
  })
})

describe('job manager cancel and start failure', () => {
  it('returns a cancelled job immediately after cancel completes', async () => {
    const { manager, store, workspaceId } = openManager()
    const job = await manager.createJob({
      workspaceId,
      request: '[hang]待って',
    })

    expect(job.status).toBe('running')
    const cancelled = await manager.cancelJob(job.id)

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.completedAt).toBeTruthy()
    expect(store.listRuns(job.id)[0]?.status).toBe('cancelled')
    expect((await manager.cancelJob(job.id)).status).toBe('cancelled')
  })

  it('marks a start failure as failed without leaving an active process', async () => {
    const { manager, store, workspaceId } = openManager({
      adapter: failingAdapter(),
    })

    await expect(
      manager.createJob({
        workspaceId,
        request: '調べて',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'PROCESS_SPAWN_REJECTED',
      message: '仕事を開始できませんでした',
    } satisfies Partial<AppError>)

    const jobs = store.listJobs(workspaceId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('failed')
    expect(jobs[0]?.completedAt).toBeTruthy()
    expect(store.listRuns(jobs[0]?.id ?? '')[0]?.status).toBe('failed')
    const failedJobId = jobs[0]?.id
    expect(failedJobId).toBeTruthy()
    if (!failedJobId) {
      throw new Error('expected a failed job')
    }
    expect(manager.listApprovals({ jobId: failedJobId })).toEqual([])
  })

  it('leaves approval pending when the provider rejects the decision', async () => {
    const adapter = createApprovalAdapter({
      respond: async () => {
        throw new Error('provider still waiting /secret/token')
      },
    })
    const { manager, store, workspaceId } = openManager({ adapter })
    const job = await manager.createJob({
      workspaceId,
      request: '調べて',
    })
    const approval = await waitForApproval(manager, job.id)

    await expect(
      manager.resolveApproval(approval.id, 'approved'),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'PROCESS_SPAWN_REJECTED',
      message: '確認を渡せませんでした',
    } satisfies Partial<AppError>)

    expect(store.getApproval(approval.id)).toMatchObject({
      status: 'pending',
      resolvedAt: null,
    })
    expect(manager.getJob(job.id).status).toBe('waiting_for_user')
    expect(
      store
        .listEvents(job.id)
        .some((event) => event.type === 'approval.resolved'),
    ).toBe(false)
  })

  it('serializes concurrent resolve calls and sends one provider decision', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let providerCalls = 0
    const adapter = createApprovalAdapter({
      respond: async () => {
        providerCalls += 1
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => {
          setTimeout(resolve, 40)
        })
        inFlight -= 1
      },
    })
    const { manager, store, workspaceId } = openManager({ adapter })
    const job = await manager.createJob({
      workspaceId,
      request: '調べて',
    })
    const approval = await waitForApproval(manager, job.id)

    const results = await Promise.allSettled([
      manager.resolveApproval(approval.id, 'approved'),
      manager.resolveApproval(approval.id, 'approved'),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(
      rejected[0]?.status === 'rejected' &&
        rejected[0].reason instanceof AppError &&
        rejected[0].reason.code === 'APPROVAL_NOT_PENDING',
    ).toBe(true)
    expect(providerCalls).toBe(1)
    expect(maxInFlight).toBe(1)
    expect(store.getApproval(approval.id)?.status).toBe('approved')
    expect(manager.getJob(job.id).status).toBe('running')
    expect(
      store
        .listEvents(job.id)
        .filter((event) => event.type === 'approval.resolved'),
    ).toHaveLength(1)
  })

  it('persists a late session id once without duplicating rows', async () => {
    let sessionId: string | undefined
    const adapter: AgentProviderAdapter = {
      ...failingAdapter(),
      async startRun(specification) {
        return createProviderRunHandle({
          runId: specification.runId,
          providerId: 'fake',
          getSessionId: () => sessionId,
          events: async function* () {
            yield {
              type: 'run.started' as const,
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '仕事を始めます',
            }
            sessionId = 'late-session'
            yield {
              type: 'run.state_changed' as const,
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '調査しています',
              state: 'planning' as const,
            }
            yield {
              type: 'run.state_changed' as const,
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '整理しています',
              state: 'organizing' as const,
            }
            yield {
              type: 'run.completed' as const,
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '調査が完了しました',
            }
          },
          cancel: async () => {},
        })
      },
    }
    const { manager, store, workspaceId } = openManager({ adapter })
    const job = await manager.createJob({
      workspaceId,
      request: '調べて',
    })
    await waitForJob(manager, job.id, 'completed')
    const sessions = store.listProviderSessions(job.id)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.providerSessionId).toBe('late-session')
    expect(store.getJob(job.id)?.providerSessionId).toBe('late-session')
  })

  it('writes report files under the data directory and keeps secrets out of events', async () => {
    const secret = 'sk-artifact-secret-value'
    const adapter: AgentProviderAdapter = {
      ...failingAdapter(),
      async startRun(specification) {
        return {
          runId: specification.runId,
          providerId: 'fake',
          events: async function* () {
            yield {
              type: 'artifact.created',
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '調査結果を整理しています',
              artifactType: 'report' as const,
              title: '調査メモ',
              content: JSON.stringify({
                title: '調査メモ',
                summary: secret,
              }),
            }
            yield {
              type: 'run.completed',
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '調査が完了しました',
            }
          },
          cancel: async () => {},
        }
      },
    }
    const { manager, store, workspaceId, dataDirectory } = openManager({
      adapter,
    })
    const job = await manager.createJob({
      workspaceId,
      request: '調べて',
    })
    await waitForJob(manager, job.id, 'completed')
    const artifact = store.listArtifacts(job.id)[0]
    expect(artifact?.storagePath).toBeTruthy()
    const storagePath = artifact?.storagePath ?? ''
    expect(storagePath.startsWith(dataDirectory)).toBe(true)
    expect(existsSync(storagePath)).toBe(true)
    expect(statSync(storagePath).mode & 0o777).toBe(0o600)
    expect(readFileSync(storagePath, 'utf8')).toContain(secret)
    const events = JSON.stringify(store.listEvents(job.id))
    expect(events).not.toContain(secret)
    expect(events).not.toContain('"content"')
    expect(manager.getArtifact(artifact?.id ?? '')).toMatchObject({
      title: '調査メモ',
      storagePath,
    })
    expect(manager.getArtifact(artifact?.id ?? '')).not.toHaveProperty(
      'content',
    )
  })

  it('redacts secrets in approval summaries and event payloads', async () => {
    const secret = 'sk-live-secret-value'
    const adapter: AgentProviderAdapter = {
      ...failingAdapter(),
      async startRun(specification) {
        return {
          runId: specification.runId,
          providerId: 'fake',
          events: async function* () {
            yield {
              type: 'approval.requested' as const,
              runId: specification.runId,
              requestId: `${specification.runId}:cmd`,
              risk: 'high' as const,
              summary: `コマンド実行の確認が必要です: TOKEN=${secret}`,
              occurredAt: new Date().toISOString(),
            }
            yield {
              type: 'run.failed' as const,
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: `spawn failed Bearer ${secret}`,
            }
          },
          cancel: async () => {},
        }
      },
    }
    const { manager, store, workspaceId } = openManager({ adapter })
    const job = await manager.createJob({
      workspaceId,
      request: '調べて',
    })
    const approval = await waitForApproval(manager, job.id)
    expect(approval.summary).not.toContain(secret)
    expect(approval.summary).toContain('[redacted]')
    const serialized = JSON.stringify(store.listEvents(job.id))
    expect(serialized).not.toContain(secret)
    expect(serialized).toContain('[redacted]')
  })

  it('stores unique paths when two artifacts share a title', async () => {
    const adapter: AgentProviderAdapter = {
      ...failingAdapter(),
      async startRun(specification) {
        return {
          runId: specification.runId,
          providerId: 'fake',
          events: async function* () {
            yield {
              type: 'artifact.created' as const,
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '調査結果を整理しています',
              artifactType: 'report' as const,
              title: '調査メモ',
              content: '{"n":1}',
            }
            yield {
              type: 'artifact.created' as const,
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '調査結果を整理しています',
              artifactType: 'report' as const,
              title: '調査メモ',
              content: '{"n":2}',
            }
            yield {
              type: 'run.completed' as const,
              runId: specification.runId,
              occurredAt: new Date().toISOString(),
              summary: '調査が完了しました',
            }
          },
          cancel: async () => {},
        }
      },
    }
    const { manager, store, workspaceId } = openManager({ adapter })
    const job = await manager.createJob({
      workspaceId,
      request: '調べて',
    })
    await waitForJob(manager, job.id, 'completed')
    const artifacts = store.listArtifacts(job.id)
    expect(artifacts).toHaveLength(2)
    expect(artifacts[0]?.storagePath).toBeTruthy()
    expect(artifacts[1]?.storagePath).toBeTruthy()
    expect(artifacts[0]?.storagePath).not.toBe(artifacts[1]?.storagePath)
    expect(artifacts[0]?.id).not.toBe(artifacts[1]?.id)
    expect(
      artifacts
        .map((artifact) => readFileSync(artifact.storagePath ?? '', 'utf8'))
        .sort(),
    ).toEqual(['{"n":1}', '{"n":2}'])
  })
})

function openManagerWithStore(store: ReturnType<typeof createStore>) {
  const manager = createJobManager(store, { fakeHarnessEnabled: true })
  managers.push(manager)
  return { manager, store }
}

function openManager(options?: { adapter?: AgentProviderAdapter }) {
  const dataDirectory = track(createTemporaryDirectory())
  const repositoryPath = track(createTemporaryGitRepository())
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  const store = createStore(opened.db)
  const workspace = store.createWorkspace({
    absolutePath: repositoryPath,
    displayName: 'workshop',
    currentBranch: 'main',
    remoteName: null,
    remoteUrl: null,
    readable: true,
  })
  const manager = createJobManager(store, {
    fakeHarnessEnabled: true,
    dataDirectory,
    ...(options?.adapter ? { adapter: options.adapter } : {}),
  })
  managers.push(manager)
  return { manager, store, workspaceId: workspace.id, dataDirectory }
}

async function waitForJob(
  manager: ReturnType<typeof createJobManager>,
  jobId: string,
  status: string,
) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const job = manager.getJob(jobId)
    if (job.status === status) {
      return job
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
  throw new Error(`Timed out waiting for job ${jobId} to become ${status}`)
}

function createApprovalAdapter(options: {
  respond: () => Promise<void>
}): AgentProviderAdapter {
  const releases = new Map<string, () => void>()

  return {
    ...failingAdapter(),
    async startRun(specification) {
      let release = () => {}
      const hold = new Promise<void>((resolve) => {
        release = resolve
      })
      releases.set(specification.runId, release)
      return {
        runId: specification.runId,
        providerId: 'fake',
        events: async function* () {
          yield {
            type: 'approval.requested' as const,
            runId: specification.runId,
            requestId: `${specification.runId}:web-search`,
            risk: 'medium' as const,
            summary: '外部サイトへアクセスします',
            occurredAt: new Date().toISOString(),
          }
          await hold
        },
        cancel: async () => {
          release()
        },
      }
    },
    async respondToApproval() {
      await options.respond()
    },
    async cancelRun(runId) {
      releases.get(runId)?.()
    },
    async dispose() {
      for (const release of releases.values()) {
        release()
      }
    },
  }
}

async function waitForApproval(
  manager: ReturnType<typeof createJobManager>,
  jobId: string,
) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const pending = manager.listApprovals({ jobId, status: 'pending' })[0]
    if (pending) {
      return pending
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
  throw new Error(`Timed out waiting for approval on ${jobId}`)
}

function failingAdapter(): AgentProviderAdapter {
  return {
    id: 'fake',
    displayName: '開発用ハーネス',
    advertisedAsRealProvider: false,
    async probe() {
      throw new Error('unused')
    },
    async getAuthStatus() {
      throw new Error('unused')
    },
    async listModels() {
      return []
    },
    async getCapabilities() {
      throw new Error('unused')
    },
    async startRun() {
      throw new Error('spawn exploded with /secret/path')
    },
    async resumeRun() {
      throw new Error('unused')
    },
    async respondToApproval() {
      throw new Error('unused')
    },
    async respondToQuestion() {
      throw new Error('unused')
    },
    async cancelRun() {},
    async dispose() {},
  }
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
