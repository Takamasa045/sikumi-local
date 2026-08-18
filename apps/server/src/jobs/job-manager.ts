import { randomUUID } from 'node:crypto'
import {
  AppError,
  isAppError,
  isPermissionEscalation,
  redactSensitiveText,
  requiresDedicatedWorktree,
  type ApprovalRequest,
  type Artifact,
  type ArtifactContent,
  type DirtyWorktreePolicy,
  type Job,
  type PermissionProfileId,
  type PersistedEvent,
  type RuntimeProviderId,
} from '@sikumi-local/core'
import { createFakeProvider } from '@sikumi-local/provider-fake'
import { compileJobPrompt } from '@sikumi-local/employee-sdk'
import {
  capabilitiesMissing,
  resolveProviderSelection,
} from '@sikumi-local/provider-sdk'
import type {
  AgentProviderAdapter,
  ApprovalDecision,
  CanonicalEvent,
  ProviderCapabilities,
  ProviderRunHandle,
} from '@sikumi-local/provider-sdk'
import {
  createEmployeeRegistry,
  type EmployeeRegistry,
} from '../employees/registry.js'
import {
  assertJobCwd,
  assertRegisteredCwd,
  registeredRepositoryRoots,
} from '../providers/cwd-policy.js'
import {
  providerApiKeyEnvironment,
  resolveLiveProviderRunsEnabled,
} from '../providers/runtime.js'
import type { ProviderRegistry } from '../providers/registry.js'
import { persistJobArtifactFile } from '../artifacts/persist.js'
import { readArtifactContent } from '../artifacts/read-content.js'
import {
  applyAcceptedArtifactGrowth,
  applyJobGrowth,
} from '../growth/manager.js'
import type { AppStore } from '../storage/store.js'
import {
  applyWorktreeToCurrentTree,
  describeJobWorktree,
  discardJobWorktree,
  exportArtifactPatch,
  inspectRepositoryGitState,
  keepJobWorktreeBranch,
  persistWorktreeArtifacts,
  prepareJobWorktree,
  releaseWorktreeLock,
} from '../worktrees/manager.js'
import { createEventHub, type EventHub } from './event-hub.js'

export interface CreateJobInput {
  readonly workspaceId: string
  readonly employeeId?: string
  readonly request: string
  readonly jobType?: string
  readonly selectedProvider?: RuntimeProviderId
  readonly confirmFallbackProvider?: RuntimeProviderId
  readonly permissionProfile?: PermissionProfileId
  readonly selectedModel?: string
  readonly dirtyWorktreePolicy?: DirtyWorktreePolicy
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
  getArtifactContent(id: string): ArtifactContent
  describeWorktree(jobId: string): ReturnType<typeof describeJobWorktree>
  applyArtifact(id: string, confirm: true): Artifact
  exportArtifact(id: string, confirm: true): { exportRelPath: string }
  discardWorktree(jobId: string, confirm: true): Job
  keepWorktree(jobId: string, confirm: true): Job
  subscribe(
    jobId: string,
    listener: (event: PersistedEvent) => void,
  ): () => void
  subscribeAll(listener: (event: PersistedEvent) => void): () => void
  listAllEvents(): PersistedEvent[]
  jobSubscriberCount(jobId: string): number
  globalSubscriberCount(): number
  dispose(): Promise<void>
}

interface ActiveJob {
  readonly jobId: string
  readonly runId: string
  readonly workspaceId: string
  readonly employeeId: string
  readonly cwd: string
  readonly handle: ProviderRunHandle
  readonly adapter: AgentProviderAdapter
  readonly approvalRequestIds: Map<string, string>
}

export function createJobManager(
  store: AppStore,
  options: {
    readonly fakeHarnessEnabled: boolean
    readonly liveProviderRuns?: boolean
    readonly adapter?: AgentProviderAdapter
    readonly registry?: ProviderRegistry
    readonly employees?: EmployeeRegistry
    readonly dataDirectory?: string
  },
): JobManager {
  const hub: EventHub = createEventHub()
  const employees =
    options.employees ??
    createEmployeeRegistry({
      ...(options.dataDirectory
        ? { dataDirectory: options.dataDirectory }
        : {}),
    })
  const activeJobs = new Map<string, ActiveJob>()
  const approvalLocks = new Map<string, Promise<void>>()
  const liveProviderRuns = resolveLiveProviderRunsEnabled(
    options.liveProviderRuns,
  )
  const fallbackFake =
    options.fakeHarnessEnabled && !options.adapter && !options.registry
      ? createFakeProvider()
      : undefined
  orphanStaleExecutions(store)

  return {
    fakeHarnessEnabled: options.fakeHarnessEnabled,

    async createJob(input) {
      const workspace = store.getWorkspace(input.workspaceId)
      if (!workspace) {
        throw new AppError('NOT_FOUND', 'Workspaceが見つかりません', 404)
      }

      employees.refresh()
      employees.syncToStore(store)
      const listed = employees.list()
      if (listed.length === 0) {
        throw new AppError('NOT_FOUND', 'AI社員が見つかりません', 404)
      }
      const definition = input.employeeId
        ? employees.get(input.employeeId)
        : listed[0]!
      const pack = employees.getPack(definition.id)
      const persisted = store.getEmployee(definition.id)
      const jobType = input.jobType ?? 'research'
      if (!definition.supportedJobTypes.includes(jobType)) {
        throw new AppError(
          'UNSUPPORTED_JOB_TYPE',
          'この社員はこの仕事を受けられません',
          400,
        )
      }
      if (options.registry) {
        await options.registry.ensureProbed()
      }
      const available = listAvailableIds(options, liveProviderRuns)
      const employeeDefault = resolveEmployeeDefault(
        persisted?.defaultProviderId ?? null,
        definition.defaultProviderOrder,
        options.fakeHarnessEnabled,
        available,
      )
      const selection = resolveProviderSelection({
        ...(input.selectedProvider
          ? { jobOverride: input.selectedProvider }
          : {}),
        ...(input.confirmFallbackProvider
          ? { confirmFallbackProvider: input.confirmFallbackProvider }
          : {}),
        employeeDefault,
        workspaceDefault: workspace.defaultProviderId,
        fakeHarnessEnabled: options.fakeHarnessEnabled,
        available,
      })

      if (selection.kind !== 'selected') {
        throw new AppError(
          selection.kind === 'unavailable'
            ? 'PROVIDER_UNAVAILABLE'
            : options.fakeHarnessEnabled
              ? 'PROVIDER_UNAVAILABLE'
              : 'PROVIDER_EXECUTION_DISCONNECTED',
          selection.kind === 'unavailable'
            ? `${displayProvider(selection.requested)}を起動できませんでした。別の道具で始めますか？`
            : '使う道具を選んでください',
          409,
          {
            requested:
              selection.kind === 'unavailable'
                ? selection.requested
                : undefined,
            alternatives: selection.alternatives,
            confirmationRequired: true,
          },
        )
      }

      const adapter = resolveAdapter(
        options,
        selection.providerId,
        fallbackFake,
      )
      if (!adapter) {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          '選択した実行エンジンが見つかりません',
          409,
        )
      }

      const permissionProfile = definition.permissionProfile
      if (
        input.permissionProfile &&
        isPermissionEscalation(input.permissionProfile, permissionProfile)
      ) {
        throw new AppError(
          'PERMISSION_ESCALATION',
          'この社員の権限を上げることはできません',
          403,
          {
            requested: input.permissionProfile,
            allowed: permissionProfile,
          },
        )
      }
      const needsWorktree = requiresDedicatedWorktree(permissionProfile)
      let cwd = workspace.repository.absolutePath
      let worktreeRelPath: string | undefined
      if (!needsWorktree) {
        cwd = assertRegisteredCwd(store, workspace.repository.absolutePath)
      }
      await assertProviderCapabilities(
        adapter,
        definition.requiredProviderCapabilities,
        selection.providerId,
      )
      if (needsWorktree) {
        const state = inspectRepositoryGitState(
          workspace.repository.absolutePath,
        )
        if (state.dirty && !input.dirtyWorktreePolicy) {
          throw new AppError(
            'WORKTREE_DIRTY_REPO',
            '現在の作業ディレクトリに未commitの変更があります',
            409,
            {
              dirty: true,
              options: ['from-head', 'include-dirty-patch', 'cancel'],
            },
          )
        }
        if (input.dirtyWorktreePolicy === 'cancel') {
          throw new AppError(
            'WORKTREE_CANCELLED',
            'Worktree作成を中止しました',
            409,
          )
        }
      }
      const now = new Date().toISOString()
      const job = store.insertJob({
        id: randomUUID(),
        workspaceId: workspace.id,
        employeeId: definition.id,
        request: redactSensitiveText(input.request),
        jobType,
        selectedProvider: selection.providerId,
        selectedModel: input.selectedModel ?? null,
        permissionProfile,
        status: 'preparing',
        providerSessionId: null,
        createdAt: now,
        startedAt: now,
        completedAt: null,
      })
      const run = store.insertRun({
        id: randomUUID(),
        jobId: job.id,
        providerId: selection.providerId,
        status: 'running',
        createdAt: now,
        startedAt: now,
        completedAt: null,
      })
      store.updateJob(job.id, { status: 'running' })

      try {
        if (needsWorktree) {
          if (!options.dataDirectory) {
            throw new AppError(
              'WORKTREE_CREATE_FAILED',
              'Worktreeを作成する場所がありません',
              500,
            )
          }
          const prepared = prepareJobWorktree({
            store,
            dataDirectory: options.dataDirectory,
            jobId: job.id,
            employeeId: definition.id,
            repositoryId: workspace.repository.id,
            repositoryPath: workspace.repository.absolutePath,
            ...(input.dirtyWorktreePolicy
              ? { policy: input.dirtyWorktreePolicy }
              : {}),
          })
          cwd = assertJobCwd(store, prepared.cwd, prepared.cwd)
          worktreeRelPath = prepared.record.worktreeRelPath
        }
        await startProviderRun({
          adapter,
          store,
          hub,
          activeJobs,
          jobId: job.id,
          runId: run.id,
          workspaceId: workspace.id,
          employeeId: definition.id,
          cwd,
          prompt: compileJobPrompt(pack.compiled, input.request),
          permissionProfile,
          outputSchema: pack.resultSchema,
          environment: providerApiKeyEnvironment(selection.providerId),
          employees,
          ...(options.dataDirectory
            ? { dataDirectory: options.dataDirectory }
            : {}),
          ...(input.selectedModel
            ? { selectedModel: input.selectedModel }
            : {}),
          ...(worktreeRelPath ? { worktreeRelPath } : {}),
        })
      } catch (error) {
        finishJob(
          store,
          employees,
          job.id,
          run.id,
          'failed',
          options.dataDirectory,
        )
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
        persistEvent(store, hub, {
          jobId: id,
          runId: active.runId,
          type: 'run.cancelled',
          payload: { summary: '仕事を中止しました' },
          occurredAt: new Date().toISOString(),
        })
        finishJob(
          store,
          employees,
          id,
          active.runId,
          'cancelled',
          options.dataDirectory,
        )
      } else {
        const run = store.listRuns(id)[0]
        if (run) {
          finishJob(
            store,
            employees,
            id,
            run.id,
            'cancelled',
            options.dataDirectory,
          )
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
          await active.adapter.respondToApproval(requestId, decision)
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

    getArtifactContent(id) {
      const artifact = this.getArtifact(id)
      if (!options.dataDirectory) {
        throw new AppError('NOT_FOUND', '成果の本文が見つかりません', 404)
      }
      return readArtifactContent({
        artifact,
        dataDirectory: options.dataDirectory,
      })
    },

    describeWorktree(jobId) {
      const job = this.getJob(jobId)
      const workspace = store.getWorkspace(job.workspaceId)
      if (!workspace || !options.dataDirectory) {
        throw new AppError(
          'WORKTREE_NOT_FOUND',
          'Worktreeが見つかりません',
          404,
        )
      }
      return describeJobWorktree({
        store,
        dataDirectory: options.dataDirectory,
        jobId,
        repositoryPath: workspace.repository.absolutePath,
      })
    },

    applyArtifact(id, confirm) {
      const artifact = this.getArtifact(id)
      if (artifact.type !== 'patch' && artifact.type !== 'code_diff') {
        throw new AppError('VALIDATION_FAILED', 'この成果は適用できません', 400)
      }
      const job = this.getJob(artifact.jobId)
      assertTerminalWorktreeJob(job)
      const workspace = store.getWorkspace(job.workspaceId)
      if (!workspace || !options.dataDirectory) {
        throw new AppError(
          'WORKTREE_NOT_FOUND',
          'Worktreeが見つかりません',
          404,
        )
      }
      applyWorktreeToCurrentTree({
        store,
        dataDirectory: options.dataDirectory,
        jobId: job.id,
        repositoryPath: workspace.repository.absolutePath,
        confirm,
      })
      applyAcceptedArtifactGrowth({ store, job })
      return artifact
    },

    exportArtifact(id, confirm) {
      if (!options.dataDirectory) {
        throw new AppError('NOT_FOUND', '成果が見つかりません', 404)
      }
      return exportArtifactPatch({
        store,
        dataDirectory: options.dataDirectory,
        artifactId: id,
        confirm,
      })
    },

    discardWorktree(jobId, confirm) {
      const job = this.getJob(jobId)
      assertTerminalWorktreeJob(job)
      const workspace = store.getWorkspace(job.workspaceId)
      if (!workspace || !options.dataDirectory) {
        throw new AppError(
          'WORKTREE_NOT_FOUND',
          'Worktreeが見つかりません',
          404,
        )
      }
      discardJobWorktree({
        store,
        dataDirectory: options.dataDirectory,
        jobId,
        repositoryPath: workspace.repository.absolutePath,
        confirm,
      })
      return this.getJob(jobId)
    },

    keepWorktree(jobId, confirm) {
      const job = this.getJob(jobId)
      assertTerminalWorktreeJob(job)
      const workspace = store.getWorkspace(job.workspaceId)
      if (!workspace || !options.dataDirectory) {
        throw new AppError(
          'WORKTREE_NOT_FOUND',
          'Worktreeが見つかりません',
          404,
        )
      }
      keepJobWorktreeBranch({
        store,
        dataDirectory: options.dataDirectory,
        jobId,
        repositoryPath: workspace.repository.absolutePath,
        confirm,
      })
      return this.getJob(jobId)
    },

    subscribe(jobId, listener) {
      return hub.subscribe(jobId, listener)
    },

    subscribeAll(listener) {
      return hub.subscribeAll(listener)
    },

    listAllEvents() {
      return store.listAllEvents()
    },

    jobSubscriberCount(jobId) {
      return hub.jobSubscriberCount(jobId)
    },

    globalSubscriberCount() {
      return hub.globalSubscriberCount()
    },

    async dispose() {
      await Promise.all(
        [...activeJobs.values()].map((active) =>
          active.adapter.cancelRun(active.runId),
        ),
      )
      activeJobs.clear()
      if (options.registry) {
        await options.registry.dispose()
      } else if (options.adapter) {
        await options.adapter.dispose()
      } else if (fallbackFake) {
        await fallbackFake.dispose()
      }
    },
  }
}

function listAvailableIds(
  options: {
    readonly fakeHarnessEnabled: boolean
    readonly adapter?: AgentProviderAdapter
    readonly registry?: ProviderRegistry
  },
  liveProviderRuns: boolean,
): RuntimeProviderId[] {
  if (options.adapter) {
    return [options.adapter.id]
  }
  if (options.registry) {
    return options.registry.availableIds()
  }
  if (options.fakeHarnessEnabled) {
    return ['fake']
  }
  if (liveProviderRuns) {
    return ['codex', 'grok-build', 'claude-code']
  }
  return []
}

function resolveAdapter(
  options: {
    readonly adapter?: AgentProviderAdapter
    readonly registry?: ProviderRegistry
  },
  providerId: RuntimeProviderId,
  fallbackFake?: AgentProviderAdapter,
): AgentProviderAdapter | undefined {
  if (options.adapter && options.adapter.id === providerId) {
    return options.adapter
  }
  if (options.adapter && providerId === 'fake') {
    return options.adapter
  }
  if (options.registry) {
    return options.registry.get(providerId)
  }
  if (providerId === 'fake') {
    return fallbackFake
  }
  return undefined
}

async function startProviderRun(input: {
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
  readonly permissionProfile: PermissionProfileId
  readonly environment: Record<string, string>
  readonly selectedModel?: string
  readonly dataDirectory?: string
  readonly worktreeRelPath?: string
  readonly employees: EmployeeRegistry
  readonly outputSchema?: Record<string, unknown>
}): Promise<void> {
  const handle = await input.adapter.startRun({
    runId: input.runId,
    workspaceId: input.workspaceId,
    employeeId: input.employeeId,
    cwd: input.cwd,
    prompt: input.prompt,
    permissionProfile: input.permissionProfile,
    environment: input.environment,
    allowedCwdRoots: input.worktreeRelPath
      ? [input.cwd]
      : registeredRepositoryRoots(input.store),
    ...(input.selectedModel ? { model: input.selectedModel } : {}),
    outputSchema: input.outputSchema ?? {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['title', 'summary'],
      additionalProperties: false,
    },
  })

  const active: ActiveJob = {
    jobId: input.jobId,
    runId: input.runId,
    workspaceId: input.workspaceId,
    employeeId: input.employeeId,
    cwd: input.cwd,
    handle,
    adapter: input.adapter,
    approvalRequestIds: new Map(),
  }
  persistHandleSession(input.store, active)
  input.activeJobs.set(input.jobId, active)
  void consumeRun(
    input.store,
    input.hub,
    input.activeJobs,
    active,
    input.employees,
    input.dataDirectory,
    input.worktreeRelPath,
  )
}

async function consumeRun(
  store: AppStore,
  hub: EventHub,
  activeJobs: Map<string, ActiveJob>,
  active: ActiveJob,
  employees: EmployeeRegistry,
  dataDirectory?: string,
  worktreeRelPath?: string,
): Promise<void> {
  try {
    for await (const event of active.handle.events()) {
      persistHandleSession(store, active)
      applyCanonicalEvent(store, hub, active, event, employees, dataDirectory)
    }
  } catch {
    finishJob(
      store,
      employees,
      active.jobId,
      active.runId,
      'failed',
      dataDirectory,
    )
  } finally {
    activeJobs.delete(active.jobId)
    closeProviderSessions(store, active.jobId)
    if (worktreeRelPath) {
      const job = store.getJob(active.jobId)
      if (job) {
        const workspace = store.getWorkspace(job.workspaceId)
        releaseWorktreeLock(
          workspace?.repository.id ?? 'unknown',
          worktreeRelPath,
        )
      }
    }
  }
}

function applyCanonicalEvent(
  store: AppStore,
  hub: EventHub,
  active: ActiveJob,
  event: CanonicalEvent,
  employees: EmployeeRegistry,
  dataDirectory?: string,
): void {
  if (event.type === 'approval.resolved') {
    return
  }

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
    const artifactId = randomUUID()
    const title = redactSensitiveText(event.title)
    let storagePath: string | null = null
    if (dataDirectory && typeof event.content === 'string') {
      storagePath = persistJobArtifactFile({
        dataDirectory,
        jobId: active.jobId,
        artifactId,
        artifactType: event.artifactType,
        title,
        content: event.content,
      })
    }
    store.insertArtifact({
      id: artifactId,
      jobId: active.jobId,
      type: event.artifactType,
      title,
      storagePath,
      createdAt: event.occurredAt,
    })
    return
  }

  if (event.type === 'run.completed') {
    finishJob(
      store,
      employees,
      active.jobId,
      active.runId,
      event.invalidResult ? 'completed_with_invalid_result' : 'completed',
      dataDirectory,
    )
    return
  }
  if (event.type === 'run.failed') {
    finishJob(
      store,
      employees,
      active.jobId,
      active.runId,
      'failed',
      dataDirectory,
    )
    return
  }
  if (event.type === 'run.cancelled') {
    finishJob(
      store,
      employees,
      active.jobId,
      active.runId,
      'cancelled',
      dataDirectory,
    )
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
  delete rest.content
  return rest
}

function persistHandleSession(store: AppStore, active: ActiveJob): void {
  const sessionId = active.handle.providerSessionId
  if (!sessionId) {
    return
  }
  const job = store.getJob(active.jobId)
  if (job?.providerSessionId === sessionId) {
    return
  }
  const existing = store
    .listProviderSessions(active.jobId)
    .find((session) => session.providerSessionId === sessionId)
  if (!existing) {
    const now = new Date().toISOString()
    store.insertProviderSession({
      id: randomUUID(),
      providerId: active.handle.providerId,
      providerSessionId: sessionId,
      workspaceId: active.workspaceId,
      employeeId: active.employeeId,
      jobId: active.jobId,
      cwd: active.cwd,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  store.updateJob(active.jobId, { providerSessionId: sessionId })
}

function finishJob(
  store: AppStore,
  employees: EmployeeRegistry,
  jobId: string,
  runId: string,
  status:
    'completed' | 'failed' | 'cancelled' | 'completed_with_invalid_result',
  dataDirectory?: string,
): void {
  const now = new Date().toISOString()
  const current = store.getJob(jobId)
  if (!current || isTerminalJob(current.status)) {
    return
  }
  if (status === 'completed' && dataDirectory) {
    const workspace = store.getWorkspace(current.workspaceId)
    if (workspace) {
      persistWorktreeArtifacts({
        store,
        dataDirectory,
        jobId,
        repositoryPath: workspace.repository.absolutePath,
      })
    }
  }
  const finished = store.updateJob(jobId, { status, completedAt: now })
  const run = store.getRun(runId)
  if (run && !isTerminalRun(run.status)) {
    store.updateRun(runId, {
      status: status === 'completed_with_invalid_result' ? 'completed' : status,
      completedAt: now,
    })
  }
  applyJobGrowth({ store, employees, job: finished })
}

function closeProviderSessions(store: AppStore, jobId: string): void {
  const now = new Date().toISOString()
  for (const session of store.listProviderSessions(jobId)) {
    if (session.status === 'active' || session.status === 'idle') {
      store.updateProviderSession(session.id, {
        status: 'closed',
        updatedAt: now,
      })
    }
  }
}

export const CRASH_RECOVERY_REASON = 'crash-recovery'

export function orphanStaleExecutions(store: AppStore): void {
  const now = new Date().toISOString()
  const recorded = new Set(
    store
      .listAllEvents()
      .filter(
        (event) =>
          event.type === 'run.failed' &&
          event.payload.reason === CRASH_RECOVERY_REASON,
      )
      .map((event) => event.jobId),
  )

  for (const job of store.listJobs()) {
    if (!isLiveJob(job.status)) {
      continue
    }
    store.updateJob(job.id, { status: 'failed', completedAt: now })
    const run = store.listRuns(job.id)[0]
    if (run && !isTerminalRun(run.status)) {
      store.updateRun(run.id, { status: 'orphaned', completedAt: now })
    }
    if (!recorded.has(job.id)) {
      store.insertEvent({
        id: randomUUID(),
        jobId: job.id,
        runId: run?.id ?? null,
        type: 'run.failed',
        payload: {
          summary: '再起動のため実行を停止しました',
          reason: CRASH_RECOVERY_REASON,
        },
        occurredAt: now,
      })
      recorded.add(job.id)
    }
    for (const approval of store.listApprovals({
      jobId: job.id,
      status: 'pending',
    })) {
      store.updateApproval(approval.id, {
        status: 'denied',
        resolvedAt: now,
      })
    }
  }

  for (const run of store.listAllRuns()) {
    if (run.status === 'running' || run.status === 'queued') {
      store.updateRun(run.id, { status: 'orphaned', completedAt: now })
    }
  }
  for (const session of store.listProviderSessions()) {
    if (session.status === 'active' || session.status === 'idle') {
      store.updateProviderSession(session.id, {
        status: 'orphaned',
        updatedAt: now,
      })
    }
  }
}

function isLiveJob(status: Job['status']): boolean {
  return (
    status === 'queued' ||
    status === 'preparing' ||
    status === 'running' ||
    status === 'waiting_for_user'
  )
}

function isTerminalJob(status: Job['status']): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'completed_with_invalid_result'
  )
}

function assertTerminalWorktreeJob(job: Job): void {
  if (!isTerminalJob(job.status)) {
    throw new AppError(
      'WORKTREE_CONFLICT',
      '実行中のWorktreeは操作できません',
      409,
    )
  }
}

function isTerminalRun(status: string): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'orphaned'
  )
}

function resolveEmployeeDefault(
  stored: import('@sikumi-local/core').ProviderId | null,
  order: readonly import('@sikumi-local/core').ProviderId[],
  fakeHarnessEnabled: boolean,
  available: readonly RuntimeProviderId[],
): import('@sikumi-local/core').ProviderId | null {
  if (stored) {
    return stored
  }
  if (fakeHarnessEnabled) {
    return null
  }
  const preferredAvailable = order.find((id) => available.includes(id))
  if (preferredAvailable) {
    return preferredAvailable
  }
  if (available.length > 0 && order[0]) {
    return order[0]
  }
  return null
}

async function assertProviderCapabilities(
  adapter: AgentProviderAdapter,
  required: readonly (keyof ProviderCapabilities)[],
  providerId: RuntimeProviderId,
): Promise<void> {
  if (providerId === 'fake') {
    return
  }
  let capabilities: ProviderCapabilities
  try {
    capabilities = await adapter.getCapabilities()
  } catch {
    return
  }
  const missing = capabilitiesMissing(required, capabilities)
  if (missing.length > 0) {
    throw new AppError(
      'PROVIDER_CAPABILITY_MISMATCH',
      'この仕事に必要な権限へ対応していません',
      409,
      { missing },
    )
  }
}

function displayProvider(id: RuntimeProviderId): string {
  if (id === 'codex') {
    return 'Codex'
  }
  if (id === 'grok-build') {
    return 'Grok Build'
  }
  if (id === 'claude-code') {
    return 'Claude Code'
  }
  return '開発用ハーネス'
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
