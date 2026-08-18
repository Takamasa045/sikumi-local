import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import type { AgentProviderAdapter } from '@sikumi-local/provider-sdk'
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
})

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
    ...(options?.adapter ? { adapter: options.adapter } : {}),
  })
  managers.push(manager)
  return { manager, store, workspaceId: workspace.id }
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
