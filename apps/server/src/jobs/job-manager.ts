import { randomUUID } from 'node:crypto'
import {
  AppError,
  FAKE_PROVIDER_ID,
  isAppError,
  type ApprovalRequest,
  type Artifact,
  type Job,
  type PersistedEvent,
} from '@sikumi-local/core'
import { createFakeProvider } from '@sikumi-local/provider-fake'
import type {
  AgentProviderAdapter,
  ApprovalDecision,
  CanonicalEvent,
  ProviderRunHandle,
} from '@sikumi-local/provider-sdk'
import {
  assertRegisteredCwd,
  registeredRepositoryRoots,
} from '../providers/cwd-policy.js'
import type { AppStore } from '../storage/store.js'
import { createEventHub, type EventHub } from './event-hub.js'

export interface CreateJobInput {
  readonly workspaceId: string
  readonly request: string
  readonly jobType?: string
}

export interface JobManager {
  readonly fakeHarnessEnabled: boolean
  createJob(input: CreateJobInput): Promise<Job>
  getJob(id: string): Job
  listJobs(workspaceId?: string): Job[]
  listEvents(jobId: string): PersistedEvent[]
  cancelJob(id: string): Promise<Job>
  listApprovals(filter?: {
    jobId?: string
    status?: ApprovalRequest['status']
  }): ApprovalRequest[]
  resolveApproval(
    id: string,
    decision: ApprovalDecision,
  ): Promise<ApprovalRequest>
  listArtifacts(jobId?: string): Artifact[]
  getArtifact(id: string): Artifact
  subscribe(
    jobId: string,
    listener: (event: PersistedEvent) => void,
  ): () => void
  dispose(): Promise<void>
}

interface ActiveJob {
  readonly jobId: string
  readonly runId: string
  readonly handle: ProviderRunHandle
  readonly adapter: AgentProviderAdapter
  readonly approvalRequestIds: Map<string, string>
}

export function createJobManager(
  store: AppStore,
  options: {
    readonly fakeHarnessEnabled: boolean
    readonly adapter?: AgentProviderAdapter
  },
): JobManager {
  const hub: EventHub = createEventHub()
  const activeJobs = new Map<string, ActiveJob>()
  const approvalLocks = new Map<string, Promise<void>>()
  const adapter =
    options.adapter ??
    (options.fakeHarnessEnabled ? createFakeProvider() : null)

  return {
    fakeHarnessEnabled: options.fakeHarnessEnabled,

    async createJob(input) {
      if (!options.fakeHarnessEnabled || !adapter) {
        throw new AppError(
          'PROVIDER_EXECUTION_DISCONNECTED',
          '実行エンジンは未接続です',
          409,
        )
      }

      const workspace = store.getWorkspace(input.workspaceId)
      if (!workspace) {
        throw new AppError('NOT_FOUND', 'Workspaceが見つかりません', 404)
      }

      const cwd = assertRegisteredCwd(store, workspace.repository.absolutePath)
      const employee = store.ensureDefaultEmployee()
      const now = new Date().toISOString()
      const job = store.insertJob({
        id: randomUUID(),
        workspaceId: workspace.id,
        employeeId: employee.id,
        request: input.request,
        jobType: input.jobType ?? 'research',
        selectedProvider: FAKE_PROVIDER_ID,
        selectedModel: null,
        permissionProfile: 'research',
        status: 'preparing',
        providerSessionId: null,
        createdAt: now,
        startedAt: now,
        completedAt: null,
      })
      const run = store.insertRun({
        id: randomUUID(),
        jobId: job.id,
        providerId: FAKE_PROVIDER_ID,
        status: 'running',
        createdAt: now,
        startedAt: now,
        completedAt: null,
      })
      store.updateJob(job.id, { status: 'running' })

      try {
        await startFakeRun({
          adapter,
          store,
          hub,
          activeJobs,
          jobId: job.id,
          runId: run.id,
          workspaceId: workspace.id,
          employeeId: employee.id,
          cwd,
          prompt: input.request,
        })
      } catch (error) {
        finishJob(store, job.id, run.id, 'failed')
        if (isAppError(error)) {
          throw error
        }
        throw new AppError(
          'PROCESS_SPAWN_REJECTED',
          '仕事を開始できませんでした',
          500,
        )
      }

      const created = store.getJob(job.id)
      if (!created) {
        throw new AppError('NOT_FOUND', 'Jobが見つかりません', 404)
      }
      return created
    },

    getJob(id) {
      const job = store.getJob(id)
      if (!job) {
        throw new AppError('NOT_FOUND', 'Jobが見つかりません', 404)
      }
      return job
    },

    listJobs(workspaceId) {
      return store.listJobs(workspaceId)
    },

    listEvents(jobId) {
      this.getJob(jobId)
      return store.listEvents(jobId)
    },

    async cancelJob(id) {
      const job = this.getJob(id)
      if (isTerminalJob(job.status)) {
        return job
      }
      const active = activeJobs.get(id)
      if (active) {
        await active.adapter.cancelRun(active.runId)
        finishJob(store, id, active.runId, 'cancelled')
      } else {
        const run = store.listRuns(id)[0]
        if (run) {
          finishJob(store, id, run.id, 'cancelled')
        } else {
          store.updateJob(id, {
            status: 'cancelled',
            completedAt: new Date().toISOString(),
          })
        }
      }
      return this.getJob(id)
    },

    listApprovals(filter) {
      return store.listApprovals(filter)
    },

    async resolveApproval(id, decision) {
      if (!adapter) {
        throw new AppError(
          'PROVIDER_EXECUTION_DISCONNECTED',
          '実行エンジンは未接続です',
          409,
        )
      }
      return withLock(approvalLocks, id, async () => {
        const approval = store.getApproval(id)
        if (!approval) {
          throw new AppError('NOT_FOUND', '確認待ちが見つかりません', 404)
        }
        if (approval.status !== 'pending') {
          throw new AppError(
            'APPROVAL_NOT_PENDING',
            'この確認はすでに処理されています',
            409,
          )
        }

        const active = activeJobs.get(approval.jobId)
        const requestId = active?.approvalRequestIds.get(approval.id)
        if (!active || !requestId) {
          throw new AppError('NOT_FOUND', '対象の実行が見つかりません', 404)
        }

        try {
          await adapter.respondToApproval(requestId, decision)
        } catch (error) {
          if (isAppError(error)) {
            throw error
          }
          throw new AppError(
            'PROCESS_SPAWN_REJECTED',
            '確認を渡せませんでした',
            500,
          )
        }

        const now = new Date().toISOString()
        const updated = store.updateApproval(id, {
          status: decision === 'approved' ? 'approved' : 'denied',
          resolvedAt: now,
        })
        persistEvent(store, hub, {
          jobId: approval.jobId,
          runId: approval.runId,
          type: 'approval.resolved',
          payload: {
            summary:
              decision === 'approved'
                ? '確認を許可しました'
                : '確認を拒否しました',
            requestId,
            decision,
          },
          occurredAt: now,
        })
        if (decision === 'approved') {
          store.updateJob(approval.jobId, { status: 'running' })
        }
        return updated
      })
    },

    listArtifacts(jobId) {
      return store.listArtifacts(jobId)
    },

    getArtifact(id) {
      const artifact = store.getArtifact(id)
      if (!artifact) {
        throw new AppError('NOT_FOUND', '成果が見つかりません', 404)
      }
      return artifact
    },

    subscribe(jobId, listener) {
      return hub.subscribe(jobId, listener)
    },

    async dispose() {
      await Promise.all(
        [...activeJobs.values()].map((active) =>
          active.adapter.cancelRun(active.runId),
        ),
      )
      activeJobs.clear()
      if (adapter) {
        await adapter.dispose()
      }
    },
  }
}

async function startFakeRun(input: {
  readonly adapter: AgentProviderAdapter
  readonly store: AppStore
  readonly hub: EventHub
  readonly activeJobs: Map<string, ActiveJob>
  readonly jobId: string
  readonly runId: string
  readonly workspaceId: string
  readonly employeeId: string
  readonly cwd: string
  readonly prompt: string
}): Promise<void> {
  const handle = await input.adapter.startRun({
    runId: input.runId,
    workspaceId: input.workspaceId,
    employeeId: input.employeeId,
    cwd: input.cwd,
    prompt: input.prompt,
    permissionProfile: 'research',
    environment: {},
    allowedCwdRoots: registeredRepositoryRoots(input.store),
  })

  const active: ActiveJob = {
    jobId: input.jobId,
    runId: input.runId,
    handle,
    adapter: input.adapter,
    approvalRequestIds: new Map(),
  }
  input.activeJobs.set(input.jobId, active)

  void consumeRun(input.store, input.hub, input.activeJobs, active)
}

async function consumeRun(
  store: AppStore,
  hub: EventHub,
  activeJobs: Map<string, ActiveJob>,
  active: ActiveJob,
): Promise<void> {
  try {
    for await (const event of active.handle.events()) {
      applyCanonicalEvent(store, hub, active, event)
    }
  } catch {
    finishJob(store, active.jobId, active.runId, 'failed')
  } finally {
    activeJobs.delete(active.jobId)
  }
}

function applyCanonicalEvent(
  store: AppStore,
  hub: EventHub,
  active: ActiveJob,
  event: CanonicalEvent,
): void {
  persistEvent(store, hub, {
    jobId: active.jobId,
    runId: active.runId,
    type: event.type,
    payload: eventPayload(event),
    occurredAt: event.occurredAt,
  })

  if (event.type === 'approval.requested') {
    const approval = store.insertApproval({
      id: randomUUID(),
      jobId: active.jobId,
      runId: active.runId,
      risk: event.risk,
      summary: event.summary,
      status: 'pending',
      createdAt: event.occurredAt,
      resolvedAt: null,
    })
    active.approvalRequestIds.set(approval.id, event.requestId)
    store.updateJob(active.jobId, { status: 'waiting_for_user' })
    return
  }

  if (event.type === 'artifact.created') {
    store.insertArtifact({
      id: randomUUID(),
      jobId: active.jobId,
      type: event.artifactType,
      title: event.title,
      storagePath: null,
      createdAt: event.occurredAt,
    })
    return
  }

  if (event.type === 'run.completed') {
    finishJob(store, active.jobId, active.runId, 'completed')
    return
  }
  if (event.type === 'run.failed') {
    finishJob(store, active.jobId, active.runId, 'failed')
    return
  }
  if (event.type === 'run.cancelled') {
    finishJob(store, active.jobId, active.runId, 'cancelled')
  }
}

function persistEvent(
  store: AppStore,
  hub: EventHub,
  event: Omit<PersistedEvent, 'id'>,
): void {
  const persisted = store.insertEvent({
    id: randomUUID(),
    ...event,
  })
  if (event.jobId) {
    hub.publish(event.jobId, persisted)
  }
}

function eventPayload(event: CanonicalEvent): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...event }
  delete rest.type
  delete rest.runId
  delete rest.occurredAt
  return rest
}

function finishJob(
  store: AppStore,
  jobId: string,
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
): void {
  const now = new Date().toISOString()
  const current = store.getJob(jobId)
  if (!current || isTerminalJob(current.status)) {
    return
  }
  store.updateJob(jobId, { status, completedAt: now })
  const run = store.getRun(runId)
  if (run && !isTerminalRun(run.status)) {
    store.updateRun(runId, { status, completedAt: now })
  }
}

function isTerminalJob(status: Job['status']): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'completed_with_invalid_result'
  )
}

function isTerminalRun(status: string): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'orphaned'
  )
}

function withLock<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(work)
  const released = run.then(
    () => undefined,
    () => undefined,
  )
  locks.set(key, released)
  return run.finally(() => {
    if (locks.get(key) === released) {
      locks.delete(key)
    }
  })
}
