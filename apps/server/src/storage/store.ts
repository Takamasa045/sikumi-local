import { randomUUID } from 'node:crypto'
import {
  AppError,
  approvalRequestSchema,
  artifactSchema,
  employeeSchema,
  growthApplicationSchema,
  growthRecordSchema,
  installedPackSchema,
  isProviderId,
  jobWorktreeSchema,
  isRuntimeProviderId,
  isShikumiEventType,
  jobSchema,
  packPreviewRecordSchema,
  persistedEventSchema,
  providerSchema,
  providerSessionSchema,
  runSchema,
  redactSensitiveText,
  sanitizeEventPayload,
  workspaceSchema,
  worldFeatureUnlockSchema,
  type ApprovalRequest,
  type ApprovalStatus,
  type Artifact,
  type AuditEntry,
  type Employee,
  type EmployeeInstance,
  type GrowthApplication,
  type GrowthRecord,
  type InstalledPack,
  type Job,
  type JobWorktree,
  type PersistedEvent,
  type Provider,
  type ProviderSession,
  type ProviderSetting,
  type Repository,
  type Run,
  type PackPreviewRecord,
  type UserQuestion,
  type Workspace,
  type WorldFeatureUnlock,
  type WorldUnlock,
} from '@sikumi-local/core'
import { and, eq } from 'drizzle-orm'
import type { GitInspection } from '../workspaces/git-repository.js'
import type { AppDatabase } from './database.js'
import {
  createObserverStore,
  type ObserverStore,
} from './observer-store.js'
import {
  approvalRequests,
  artifacts,
  auditEntries,
  conflictFindings,
  employeeInstances,
  employees,
  events,
  externalSessions,
  growthApplications,
  growthRecords,
  installedPacks,
  jobWorktrees,
  jobs,
  observerEvents,
  packPreviews,
  providerSessions,
  providerSettings,
  providers,
  repositories,
  repositorySnapshots,
  resourceClaims,
  runs,
  sessionLabels,
  userQuestions,
  workspaces,
  worldFeatureUnlocks,
  worldUnlocks,
} from './schema.js'

const DEFAULT_WORLD_PACK_ID = 'dog-office'

export interface AppStore {
  listWorkspaces(): Workspace[]
  getWorkspace(id: string): Workspace | undefined
  findRepositoryByAbsolutePath(absolutePath: string): Repository | undefined
  createWorkspace(inspection: GitInspection, employeeName?: string): Workspace
  importDetachedWorkspace(input: {
    readonly id: string
    readonly name: string
    readonly worldPackId: string
    readonly defaultProviderId: Workspace['defaultProviderId']
    readonly createdAt: string
    readonly updatedAt: string
    readonly repository: {
      readonly displayName: string
      readonly currentBranch: string | null
      readonly remoteName: string | null
      readonly readable: boolean
    }
  }): Workspace
  updateWorkspace(
    id: string,
    patch: Partial<Pick<Workspace, 'defaultProviderId' | 'employeeName'>>,
  ): Workspace
  deleteWorkspace(id: string): void
  listProviders(): Provider[]
  insertEmployee(employee: Employee): Employee
  getEmployee(id: string): Employee | undefined
  listEmployees(): Employee[]
  updateEmployee(
    id: string,
    patch: Partial<Pick<Employee, 'defaultProviderId'>>,
  ): Employee
  insertEmployeeInstance(instance: EmployeeInstance): EmployeeInstance
  insertProviderSetting(setting: ProviderSetting): ProviderSetting
  insertJob(job: Job): Job
  getJob(id: string): Job | undefined
  listJobs(workspaceId?: string): Job[]
  updateJob(
    id: string,
    patch: Partial<
      Pick<Job, 'status' | 'providerSessionId' | 'startedAt' | 'completedAt'>
    >,
  ): Job
  insertRun(run: Run): Run
  getRun(id: string): Run | undefined
  listRuns(jobId: string): Run[]
  updateRun(
    id: string,
    patch: Partial<Pick<Run, 'status' | 'startedAt' | 'completedAt'>>,
  ): Run
  insertProviderSession(session: ProviderSession): ProviderSession
  listProviderSessions(jobId?: string): ProviderSession[]
  updateProviderSession(
    id: string,
    patch: Partial<Pick<ProviderSession, 'status' | 'updatedAt'>>,
  ): ProviderSession
  listAllRuns(): Run[]
  insertEvent(event: PersistedEvent): PersistedEvent
  listEvents(jobId: string): PersistedEvent[]
  listAllEvents(): PersistedEvent[]
  insertApproval(approval: ApprovalRequest): ApprovalRequest
  getApproval(id: string): ApprovalRequest | undefined
  listApprovals(filter?: {
    jobId?: string
    status?: ApprovalStatus
  }): ApprovalRequest[]
  updateApproval(
    id: string,
    patch: Partial<Pick<ApprovalRequest, 'status' | 'resolvedAt'>>,
  ): ApprovalRequest
  insertQuestion(question: UserQuestion): UserQuestion
  insertArtifact(artifact: Artifact): Artifact
  getArtifact(id: string): Artifact | undefined
  listArtifacts(jobId?: string): Artifact[]
  ensureDefaultEmployee(): Employee
  insertGrowthRecord(record: GrowthRecord): GrowthRecord
  listGrowthRecords(filter?: {
    employeeId?: string
    workspaceId?: string | null
  }): GrowthRecord[]
  tryInsertGrowthApplication(record: GrowthApplication): boolean
  recordGrowthOnce(input: {
    readonly application: GrowthApplication
    readonly record: GrowthRecord
  }): { readonly applied: boolean }
  listGrowthApplications(filter?: {
    employeeId?: string
    jobId?: string
  }): GrowthApplication[]
  insertWorldUnlock(unlock: WorldUnlock): WorldUnlock
  listWorldUnlocks(workspaceId?: string): WorldUnlock[]
  insertWorldFeatureUnlock(unlock: WorldFeatureUnlock): WorldFeatureUnlock
  listWorldFeatureUnlocks(workspaceId?: string): WorldFeatureUnlock[]
  insertAuditEntry(entry: AuditEntry): AuditEntry
  insertPack(pack: InstalledPack): InstalledPack
  updatePack(id: string, patch: Partial<InstalledPack>): InstalledPack
  deletePack(id: string): void
  getPack(id: string): InstalledPack | undefined
  findPack(
    kind: InstalledPack['kind'],
    packId: string,
  ): InstalledPack | undefined
  listPacks(): InstalledPack[]
  insertJobWorktree(record: JobWorktree): JobWorktree
  getJobWorktreeByJobId(jobId: string): JobWorktree | undefined
  listActiveWriteWorktrees(): JobWorktree[]
  updateJobWorktree(
    id: string,
    patch: Partial<Pick<JobWorktree, 'status' | 'updatedAt'>>,
  ): JobWorktree
  insertPackPreview(record: PackPreviewRecord): PackPreviewRecord
  getPackPreview(id: string): PackPreviewRecord | undefined
  deletePackPreview(id: string): void
}

export type CombinedStore = AppStore & ObserverStore

export function createStore(db: AppDatabase): CombinedStore {
  return {
    ...createObserverStore(db),
    listWorkspaces() {
      const rows = db.select().from(workspaces).all()
      return rows
        .map((row) => assembleWorkspace(db, row))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },

    getWorkspace(id) {
      const row = db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, id))
        .get()
      return row ? assembleWorkspace(db, row) : undefined
    },

    findRepositoryByAbsolutePath(absolutePath) {
      const row = db
        .select()
        .from(repositories)
        .where(eq(repositories.absolutePath, absolutePath))
        .get()
      return row ? mapRepository(row) : undefined
    },

    createWorkspace(inspection, employeeName) {
      const now = new Date().toISOString()
      const workspaceId = randomUUID()
      const repositoryId = randomUUID()

      db.transaction((tx) => {
        tx.insert(workspaces)
          .values({
            id: workspaceId,
            name: inspection.displayName,
            employeeName: employeeName ?? null,
            defaultProviderId: null,
            worldPackId: DEFAULT_WORLD_PACK_ID,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        tx.insert(repositories)
          .values({
            id: repositoryId,
            workspaceId,
            absolutePath: inspection.absolutePath,
            displayName: inspection.displayName,
            currentBranch: inspection.currentBranch,
            remoteName: inspection.remoteName,
            remoteUrl: inspection.remoteUrl,
            readable: inspection.readable,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        tx.insert(auditEntries)
          .values({
            id: randomUUID(),
            action: 'workspace.registered',
            subjectType: 'workspace',
            subjectId: workspaceId,
            details: JSON.stringify({
              absolutePath: inspection.absolutePath,
              displayName: inspection.displayName,
            }),
            createdAt: now,
          })
          .run()
      })

      const created = this.getWorkspace(workspaceId)
      if (!created) {
        throw new Error('Workspace was not persisted')
      }
      return created
    },

    importDetachedWorkspace(input) {
      db.transaction((tx) => {
        tx.insert(workspaces)
          .values({
            id: input.id,
            name: input.name,
            defaultProviderId: input.defaultProviderId,
            worldPackId: input.worldPackId,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          })
          .run()
        tx.insert(repositories)
          .values({
            id: randomUUID(),
            workspaceId: input.id,
            absolutePath: `unlinked:${input.id}`,
            displayName: input.repository.displayName,
            currentBranch: input.repository.currentBranch,
            remoteName: input.repository.remoteName,
            remoteUrl: null,
            readable: false,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          })
          .run()
      })
      const created = this.getWorkspace(input.id)
      if (!created) {
        throw new Error('Workspace snapshot was not persisted')
      }
      return created
    },

    deleteWorkspace(id) {
      const current = this.getWorkspace(id)
      if (!current) {
        throw new AppError('NOT_FOUND', '場所が見つかりません', 404)
      }
      const repositoryId = current.repository.id
      const now = new Date().toISOString()

      db.transaction((tx) => {
        const sessions = tx
          .select()
          .from(externalSessions)
          .where(eq(externalSessions.repositoryId, repositoryId))
          .all()
        for (const session of sessions) {
          tx.delete(sessionLabels)
            .where(eq(sessionLabels.externalSessionId, session.id))
            .run()
        }
        tx.delete(resourceClaims)
          .where(eq(resourceClaims.repositoryId, repositoryId))
          .run()
        tx.delete(observerEvents)
          .where(eq(observerEvents.repositoryId, repositoryId))
          .run()
        tx.delete(repositorySnapshots)
          .where(eq(repositorySnapshots.repositoryId, repositoryId))
          .run()
        tx.delete(conflictFindings)
          .where(eq(conflictFindings.repositoryId, repositoryId))
          .run()
        tx.delete(externalSessions)
          .where(eq(externalSessions.repositoryId, repositoryId))
          .run()
        tx.delete(worldUnlocks).where(eq(worldUnlocks.workspaceId, id)).run()
        tx.delete(worldFeatureUnlocks)
          .where(eq(worldFeatureUnlocks.workspaceId, id))
          .run()
        tx.delete(growthRecords).where(eq(growthRecords.workspaceId, id)).run()
        tx.delete(providerSessions)
          .where(eq(providerSessions.workspaceId, id))
          .run()
        tx.insert(auditEntries)
          .values({
            id: randomUUID(),
            action: 'workspace.unregistered',
            subjectType: 'workspace',
            subjectId: id,
            details: JSON.stringify({
              absolutePath: current.repository.absolutePath,
              displayName: current.repository.displayName,
              diskPreserved: true,
            }),
            createdAt: now,
          })
          .run()
        tx.delete(workspaces).where(eq(workspaces.id, id)).run()
      })
    },

    updateWorkspace(id, patch) {
      const current = this.getWorkspace(id)
      if (!current) {
        throw new AppError('NOT_FOUND', '場所が見つかりません', 404)
      }
      const next = workspaceSchema.parse({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      })
      db.update(workspaces)
        .set({
          ...(patch.defaultProviderId === undefined
            ? {}
            : { defaultProviderId: next.defaultProviderId }),
          ...(patch.employeeName === undefined
            ? {}
            : { employeeName: next.employeeName }),
          updatedAt: next.updatedAt,
        })
        .where(eq(workspaces.id, id))
        .run()
      return next
    },

    listProviders() {
      return db
        .select()
        .from(providers)
        .all()
        .map((row) =>
          providerSchema.parse({
            id: parseCatalogProviderId(row.id),
            displayName: row.displayName,
            executionConnected: false,
          }),
        )
    },

    insertEmployee(employee) {
      const parsed = employeeSchema.parse(employee)
      db.insert(employees)
        .values({
          id: parsed.id,
          packId: parsed.packId,
          name: parsed.name,
          role: parsed.role,
          defaultProviderId: parsed.defaultProviderId,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        })
        .run()
      return parsed
    },

    getEmployee(id) {
      return this.listEmployees().find((employee) => employee.id === id)
    },

    listEmployees() {
      return db
        .select()
        .from(employees)
        .all()
        .map((row) =>
          employeeSchema.parse({
            id: row.id,
            packId: row.packId,
            name: row.name,
            role: row.role,
            defaultProviderId: parseOptionalProviderId(row.defaultProviderId),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }),
        )
    },

    updateEmployee(id, patch) {
      const current = this.getEmployee(id)
      if (!current) {
        throw new AppError('NOT_FOUND', 'AI社員が見つかりません', 404)
      }
      const next = employeeSchema.parse({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      })
      db.update(employees)
        .set({
          defaultProviderId: next.defaultProviderId,
          updatedAt: next.updatedAt,
        })
        .where(eq(employees.id, id))
        .run()
      return next
    },

    insertEmployeeInstance(instance) {
      db.insert(employeeInstances)
        .values({
          id: instance.id,
          workspaceId: instance.workspaceId,
          employeeId: instance.employeeId,
          characterPackId: instance.characterPackId,
          createdAt: instance.createdAt,
        })
        .run()
      return instance
    },

    insertProviderSetting(setting) {
      db.insert(providerSettings)
        .values({
          id: setting.id,
          workspaceId: setting.workspaceId,
          providerId: setting.providerId,
          selectedModel: setting.selectedModel,
          createdAt: setting.createdAt,
          updatedAt: setting.updatedAt,
        })
        .run()
      return setting
    },

    insertJob(job) {
      const parsed = jobSchema.parse(job)
      db.insert(jobs)
        .values({
          id: parsed.id,
          workspaceId: parsed.workspaceId,
          employeeId: parsed.employeeId,
          request: parsed.request,
          jobType: parsed.jobType,
          selectedProvider: parsed.selectedProvider,
          selectedModel: parsed.selectedModel,
          permissionProfile: parsed.permissionProfile,
          status: parsed.status,
          providerSessionId: parsed.providerSessionId,
          createdAt: parsed.createdAt,
          startedAt: parsed.startedAt,
          completedAt: parsed.completedAt,
        })
        .run()
      return parsed
    },

    getJob(id) {
      const row = db.select().from(jobs).where(eq(jobs.id, id)).get()
      return row ? mapJob(row) : undefined
    },

    listJobs(workspaceId) {
      const rows = workspaceId
        ? db.select().from(jobs).where(eq(jobs.workspaceId, workspaceId)).all()
        : db.select().from(jobs).all()
      return rows
        .map(mapJob)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },

    updateJob(id, patch) {
      const current = this.getJob(id)
      if (!current) {
        throw new AppError('NOT_FOUND', 'Jobが見つかりません', 404)
      }
      const next = jobSchema.parse({ ...current, ...patch })
      db.update(jobs)
        .set({
          status: next.status,
          providerSessionId: next.providerSessionId,
          startedAt: next.startedAt,
          completedAt: next.completedAt,
        })
        .where(eq(jobs.id, id))
        .run()
      return next
    },

    insertRun(run) {
      const parsed = runSchema.parse(run)
      db.insert(runs)
        .values({
          id: parsed.id,
          jobId: parsed.jobId,
          providerId: parsed.providerId,
          status: parsed.status,
          createdAt: parsed.createdAt,
          startedAt: parsed.startedAt,
          completedAt: parsed.completedAt,
        })
        .run()
      return parsed
    },

    getRun(id) {
      const row = db.select().from(runs).where(eq(runs.id, id)).get()
      return row ? mapRun(row) : undefined
    },

    listRuns(jobId) {
      return db
        .select()
        .from(runs)
        .where(eq(runs.jobId, jobId))
        .all()
        .map(mapRun)
    },

    updateRun(id, patch) {
      const current = this.getRun(id)
      if (!current) {
        throw new AppError('NOT_FOUND', 'Runが見つかりません', 404)
      }
      const next = runSchema.parse({ ...current, ...patch })
      db.update(runs)
        .set({
          status: next.status,
          startedAt: next.startedAt,
          completedAt: next.completedAt,
        })
        .where(eq(runs.id, id))
        .run()
      return next
    },

    insertProviderSession(session) {
      const parsed = providerSessionSchema.parse(session)
      db.insert(providerSessions)
        .values({
          id: parsed.id,
          providerId: parsed.providerId,
          providerSessionId: parsed.providerSessionId,
          workspaceId: parsed.workspaceId,
          employeeId: parsed.employeeId,
          jobId: parsed.jobId,
          cwd: parsed.cwd,
          status: parsed.status,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        })
        .run()
      return parsed
    },

    listProviderSessions(jobId) {
      const rows = jobId
        ? db
            .select()
            .from(providerSessions)
            .where(eq(providerSessions.jobId, jobId))
            .all()
        : db.select().from(providerSessions).all()
      return rows.map((row) =>
        providerSessionSchema.parse({
          id: row.id,
          providerId: parseRuntimeProviderId(row.providerId),
          providerSessionId: row.providerSessionId,
          workspaceId: row.workspaceId,
          employeeId: row.employeeId,
          jobId: row.jobId,
          cwd: row.cwd,
          status: row.status,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      )
    },

    updateProviderSession(id, patch) {
      const current = this.listProviderSessions().find(
        (session) => session.id === id,
      )
      if (!current) {
        throw new AppError('NOT_FOUND', 'Provider sessionが見つかりません', 404)
      }
      const next = providerSessionSchema.parse({ ...current, ...patch })
      db.update(providerSessions)
        .set({
          status: next.status,
          updatedAt: next.updatedAt,
        })
        .where(eq(providerSessions.id, id))
        .run()
      return next
    },

    listAllRuns() {
      return db.select().from(runs).all().map(mapRun)
    },

    insertEvent(event) {
      if (!isShikumiEventType(event.type)) {
        throw new AppError('VALIDATION_FAILED', 'Unknown event type', 400)
      }

      const parsed = persistedEventSchema.parse({
        ...event,
        payload: sanitizeEventPayload(event.payload),
      })
      db.insert(events)
        .values({
          id: parsed.id,
          jobId: parsed.jobId,
          runId: parsed.runId,
          type: parsed.type,
          payload: JSON.stringify(parsed.payload),
          occurredAt: parsed.occurredAt,
        })
        .run()
      return parsed
    },

    listEvents(jobId) {
      return this.listAllEvents().filter((event) => event.jobId === jobId)
    },

    listAllEvents() {
      return db
        .select()
        .from(events)
        .all()
        .map((row) =>
          persistedEventSchema.parse({
            id: row.id,
            jobId: row.jobId,
            runId: row.runId,
            type: row.type,
            payload: JSON.parse(row.payload) as Record<string, unknown>,
            occurredAt: row.occurredAt,
          }),
        )
        .sort((left, right) => {
          const byTime = left.occurredAt.localeCompare(right.occurredAt)
          return byTime === 0 ? left.id.localeCompare(right.id) : byTime
        })
    },

    getApproval(id) {
      const row = db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, id))
        .get()
      return row ? mapApproval(row) : undefined
    },

    listApprovals(filter) {
      return db
        .select()
        .from(approvalRequests)
        .all()
        .map(mapApproval)
        .filter((approval) => {
          if (filter?.jobId && approval.jobId !== filter.jobId) {
            return false
          }
          if (filter?.status && approval.status !== filter.status) {
            return false
          }
          return true
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },

    updateApproval(id, patch) {
      const current = this.getApproval(id)
      if (!current) {
        throw new AppError('NOT_FOUND', '確認待ちが見つかりません', 404)
      }
      const next = approvalRequestSchema.parse({ ...current, ...patch })
      db.update(approvalRequests)
        .set({
          status: next.status,
          resolvedAt: next.resolvedAt,
        })
        .where(eq(approvalRequests.id, id))
        .run()
      return next
    },

    insertApproval(approval) {
      const parsed = approvalRequestSchema.parse({
        ...approval,
        summary: redactSensitiveText(approval.summary),
      })
      db.insert(approvalRequests)
        .values({
          id: parsed.id,
          jobId: parsed.jobId,
          runId: parsed.runId,
          risk: parsed.risk,
          summary: parsed.summary,
          status: parsed.status,
          createdAt: parsed.createdAt,
          resolvedAt: parsed.resolvedAt,
        })
        .run()
      return parsed
    },

    insertQuestion(question) {
      db.insert(userQuestions)
        .values({
          id: question.id,
          jobId: question.jobId,
          prompt: question.prompt,
          status: question.status,
          answer: question.answer,
          createdAt: question.createdAt,
          answeredAt: question.answeredAt,
        })
        .run()
      return question
    },

    getArtifact(id) {
      const row = db.select().from(artifacts).where(eq(artifacts.id, id)).get()
      return row ? mapArtifact(row) : undefined
    },

    listArtifacts(jobId) {
      const rows = jobId
        ? db.select().from(artifacts).where(eq(artifacts.jobId, jobId)).all()
        : db.select().from(artifacts).all()
      return rows
        .map(mapArtifact)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },

    ensureDefaultEmployee() {
      const existing = this.listEmployees().find(
        (employee) => employee.id === 'saguru',
      )
      if (existing) {
        return existing
      }
      const now = new Date().toISOString()
      return this.insertEmployee({
        id: 'saguru',
        packId: 'saguru',
        name: 'サグル',
        role: '調査担当',
        defaultProviderId: null,
        createdAt: now,
        updatedAt: now,
      })
    },

    insertArtifact(artifact) {
      const parsed = artifactSchema.parse({
        ...artifact,
        title: redactSensitiveText(artifact.title),
      })
      db.insert(artifacts)
        .values({
          id: parsed.id,
          jobId: parsed.jobId,
          type: parsed.type,
          title: parsed.title,
          storagePath: parsed.storagePath,
          createdAt: parsed.createdAt,
        })
        .run()
      return parsed
    },

    insertGrowthRecord(record) {
      const parsed = growthRecordSchema.parse(record)
      db.insert(growthRecords)
        .values({
          id: parsed.id,
          employeeId: parsed.employeeId,
          workspaceId: parsed.workspaceId,
          metric: parsed.metric,
          value: parsed.value,
          createdAt: parsed.createdAt,
        })
        .run()
      return parsed
    },

    listGrowthRecords(filter) {
      return db
        .select()
        .from(growthRecords)
        .all()
        .map((row) =>
          growthRecordSchema.parse({
            id: row.id,
            employeeId: row.employeeId,
            workspaceId: row.workspaceId,
            metric: row.metric,
            value: row.value,
            createdAt: row.createdAt,
          }),
        )
        .filter((record) => {
          if (filter?.employeeId && record.employeeId !== filter.employeeId) {
            return false
          }
          if (filter && 'workspaceId' in filter) {
            return record.workspaceId === filter.workspaceId
          }
          return true
        })
    },

    tryInsertGrowthApplication(record) {
      const parsed = growthApplicationSchema.parse(record)
      const existing = db
        .select()
        .from(growthApplications)
        .where(
          and(
            eq(growthApplications.jobId, parsed.jobId),
            eq(growthApplications.employeeId, parsed.employeeId),
            eq(growthApplications.scopeKey, parsed.scopeKey),
            eq(growthApplications.metric, parsed.metric),
          ),
        )
        .get()
      if (existing) {
        return false
      }
      db.insert(growthApplications)
        .values({
          id: parsed.id,
          jobId: parsed.jobId,
          employeeId: parsed.employeeId,
          scopeKey: parsed.scopeKey,
          metric: parsed.metric,
          value: parsed.value,
          createdAt: parsed.createdAt,
        })
        .run()
      return true
    },

    recordGrowthOnce(input) {
      const application = growthApplicationSchema.parse(input.application)
      const record = growthRecordSchema.parse(input.record)
      try {
        db.transaction((tx) => {
          tx.insert(growthApplications)
            .values({
              id: application.id,
              jobId: application.jobId,
              employeeId: application.employeeId,
              scopeKey: application.scopeKey,
              metric: application.metric,
              value: application.value,
              createdAt: application.createdAt,
            })
            .run()
          tx.insert(growthRecords)
            .values({
              id: record.id,
              employeeId: record.employeeId,
              workspaceId: record.workspaceId,
              metric: record.metric,
              value: record.value,
              createdAt: record.createdAt,
            })
            .run()
        })
        return { applied: true }
      } catch (error) {
        if (isGrowthApplicationConflict(error)) {
          return { applied: false }
        }
        throw error
      }
    },

    listGrowthApplications(filter) {
      return db
        .select()
        .from(growthApplications)
        .all()
        .map((row) =>
          growthApplicationSchema.parse({
            id: row.id,
            jobId: row.jobId,
            employeeId: row.employeeId,
            scopeKey: row.scopeKey,
            metric: row.metric,
            value: row.value,
            createdAt: row.createdAt,
          }),
        )
        .filter((record) => {
          if (filter?.employeeId && record.employeeId !== filter.employeeId) {
            return false
          }
          if (filter?.jobId && record.jobId !== filter.jobId) {
            return false
          }
          return true
        })
    },

    insertWorldUnlock(unlock) {
      db.insert(worldUnlocks)
        .values({
          id: unlock.id,
          workspaceId: unlock.workspaceId,
          worldPackId: unlock.worldPackId,
          unlockedAt: unlock.unlockedAt,
        })
        .run()
      return unlock
    },

    listWorldUnlocks(workspaceId) {
      return db
        .select()
        .from(worldUnlocks)
        .all()
        .filter((row) => !workspaceId || row.workspaceId === workspaceId)
        .map((row) => ({
          id: row.id,
          workspaceId: row.workspaceId,
          worldPackId: row.worldPackId,
          unlockedAt: row.unlockedAt,
        }))
    },

    insertWorldFeatureUnlock(unlock) {
      const parsed = worldFeatureUnlockSchema.parse(unlock)
      const existing = db
        .select()
        .from(worldFeatureUnlocks)
        .where(
          and(
            eq(worldFeatureUnlocks.workspaceId, parsed.workspaceId),
            eq(worldFeatureUnlocks.worldPackId, parsed.worldPackId),
            eq(worldFeatureUnlocks.unlockId, parsed.unlockId),
          ),
        )
        .get()
      if (existing) {
        return worldFeatureUnlockSchema.parse({
          id: existing.id,
          workspaceId: existing.workspaceId,
          worldPackId: existing.worldPackId,
          unlockId: existing.unlockId,
          unlockedAt: existing.unlockedAt,
        })
      }
      db.insert(worldFeatureUnlocks)
        .values({
          id: parsed.id,
          workspaceId: parsed.workspaceId,
          worldPackId: parsed.worldPackId,
          unlockId: parsed.unlockId,
          unlockedAt: parsed.unlockedAt,
        })
        .run()
      return parsed
    },

    listWorldFeatureUnlocks(workspaceId) {
      return db
        .select()
        .from(worldFeatureUnlocks)
        .all()
        .filter((row) => !workspaceId || row.workspaceId === workspaceId)
        .map((row) =>
          worldFeatureUnlockSchema.parse({
            id: row.id,
            workspaceId: row.workspaceId,
            worldPackId: row.worldPackId,
            unlockId: row.unlockId,
            unlockedAt: row.unlockedAt,
          }),
        )
    },

    insertAuditEntry(entry) {
      db.insert(auditEntries)
        .values({
          id: entry.id,
          action: entry.action,
          subjectType: entry.subjectType,
          subjectId: entry.subjectId,
          details: JSON.stringify(entry.details),
          createdAt: entry.createdAt,
        })
        .run()
      return entry
    },

    insertPack(pack) {
      const parsed = installedPackSchema.parse(pack)
      db.insert(installedPacks)
        .values({
          id: parsed.id,
          kind: parsed.kind,
          packId: parsed.packId,
          version: parsed.version,
          sourcePath: parsed.sourcePath,
          sourceKind: parsed.sourceKind,
          sourceDisplay: parsed.sourceDisplay,
          commitHash: parsed.commitHash,
          builtin: parsed.builtin,
          installedAt: parsed.installedAt,
        })
        .run()
      return parsed
    },

    updatePack(id, patch) {
      const current = this.getPack(id)
      if (!current) {
        throw new AppError('NOT_FOUND', 'Packが見つかりません', 404)
      }
      const next = installedPackSchema.parse({ ...current, ...patch })
      db.update(installedPacks)
        .set({
          version: next.version,
          sourcePath: next.sourcePath,
          sourceKind: next.sourceKind,
          sourceDisplay: next.sourceDisplay,
          commitHash: next.commitHash,
          builtin: next.builtin,
          installedAt: next.installedAt,
        })
        .where(eq(installedPacks.id, id))
        .run()
      return next
    },

    deletePack(id) {
      const current = this.getPack(id)
      if (!current) {
        throw new AppError('NOT_FOUND', 'Packが見つかりません', 404)
      }
      if (current.builtin) {
        throw new AppError(
          'PACK_BUILTIN_PROTECTED',
          '組み込みPackは削除できません',
          403,
        )
      }
      db.delete(installedPacks).where(eq(installedPacks.id, id)).run()
    },

    getPack(id) {
      return this.listPacks().find((pack) => pack.id === id)
    },

    findPack(kind, packId) {
      return this.listPacks().find(
        (pack) => pack.kind === kind && pack.packId === packId,
      )
    },

    listPacks() {
      return db
        .select()
        .from(installedPacks)
        .all()
        .map((row) =>
          installedPackSchema.parse({
            id: row.id,
            kind: row.kind,
            packId: row.packId,
            version: row.version,
            sourcePath: row.sourcePath,
            sourceKind: row.sourceKind,
            sourceDisplay: row.sourceDisplay,
            commitHash: row.commitHash,
            builtin: Boolean(row.builtin),
            installedAt: row.installedAt,
          }),
        )
    },

    insertJobWorktree(record) {
      const parsed = jobWorktreeSchema.parse(record)
      db.insert(jobWorktrees)
        .values({
          id: parsed.id,
          jobId: parsed.jobId,
          repositoryId: parsed.repositoryId,
          worktreeRelPath: parsed.worktreeRelPath,
          branchName: parsed.branchName,
          baseCommit: parsed.baseCommit,
          includeDirtyPatch: parsed.includeDirtyPatch,
          status: parsed.status,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        })
        .run()
      return parsed
    },

    getJobWorktreeByJobId(jobId) {
      const row = db
        .select()
        .from(jobWorktrees)
        .where(eq(jobWorktrees.jobId, jobId))
        .get()
      return row ? mapJobWorktree(row) : undefined
    },

    listActiveWriteWorktrees() {
      return db
        .select()
        .from(jobWorktrees)
        .all()
        .map(mapJobWorktree)
        .filter(
          (record) =>
            record.status === 'prepared' || record.status === 'active',
        )
    },

    updateJobWorktree(id, patch) {
      const current = db
        .select()
        .from(jobWorktrees)
        .where(eq(jobWorktrees.id, id))
        .get()
      if (!current) {
        throw new AppError(
          'WORKTREE_NOT_FOUND',
          'Worktreeが見つかりません',
          404,
        )
      }
      const next = jobWorktreeSchema.parse({
        ...mapJobWorktree(current),
        ...patch,
      })
      db.update(jobWorktrees)
        .set({
          status: next.status,
          updatedAt: next.updatedAt,
        })
        .where(eq(jobWorktrees.id, id))
        .run()
      return next
    },

    insertPackPreview(record) {
      const parsed = packPreviewRecordSchema.parse(record)
      db.insert(packPreviews)
        .values({
          id: parsed.id,
          kind: parsed.kind,
          packId: parsed.packId,
          version: parsed.version,
          sourceKind: parsed.sourceKind,
          sourceDisplay: parsed.sourceDisplay,
          validationJson: JSON.stringify(parsed.validation),
          fileSummaryJson: JSON.stringify(parsed.fileSummary),
          gitCommit: parsed.gitCommit,
          gitChanges: parsed.gitChanges,
          stagingRelPath: parsed.stagingRelPath,
          createdAt: parsed.createdAt,
          expiresAt: parsed.expiresAt,
        })
        .run()
      return parsed
    },

    getPackPreview(id) {
      const row = db
        .select()
        .from(packPreviews)
        .where(eq(packPreviews.id, id))
        .get()
      if (!row) {
        return undefined
      }
      return packPreviewRecordSchema.parse({
        id: row.id,
        kind: row.kind,
        packId: row.packId,
        version: row.version,
        sourceKind: row.sourceKind,
        sourceDisplay: row.sourceDisplay,
        validation: JSON.parse(row.validationJson) as Record<string, unknown>,
        fileSummary: JSON.parse(row.fileSummaryJson) as Record<string, unknown>,
        gitCommit: row.gitCommit,
        gitChanges: row.gitChanges,
        stagingRelPath: row.stagingRelPath,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      })
    },

    deletePackPreview(id) {
      db.delete(packPreviews).where(eq(packPreviews.id, id)).run()
    },
  }
}

function assembleWorkspace(
  db: AppDatabase,
  row: typeof workspaces.$inferSelect,
): Workspace {
  const repository = db
    .select()
    .from(repositories)
    .where(eq(repositories.workspaceId, row.id))
    .get()

  if (!repository) {
    throw new Error(`Workspace ${row.id} is missing its repository`)
  }

  return workspaceSchema.parse({
    id: row.id,
    name: row.name,
    ...(row.employeeName ? { employeeName: row.employeeName } : {}),
    defaultProviderId: parseOptionalProviderId(row.defaultProviderId),
    worldPackId: row.worldPackId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    repository: mapRepository(repository),
  })
}

function mapRepository(row: typeof repositories.$inferSelect): Repository {
  return {
    id: row.id,
    absolutePath: row.absolutePath,
    displayName: row.displayName,
    currentBranch: row.currentBranch,
    remoteName: row.remoteName,
    remoteUrl: row.remoteUrl,
    readable: row.readable,
  }
}

function mapJob(row: typeof jobs.$inferSelect): Job {
  return jobSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    employeeId: row.employeeId,
    request: row.request,
    jobType: row.jobType,
    selectedProvider: parseRuntimeProviderId(row.selectedProvider),
    selectedModel: row.selectedModel,
    permissionProfile: row.permissionProfile,
    status: row.status,
    providerSessionId: row.providerSessionId,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  })
}

function mapRun(row: typeof runs.$inferSelect): Run {
  return runSchema.parse({
    id: row.id,
    jobId: row.jobId,
    providerId: parseRuntimeProviderId(row.providerId),
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  })
}

function mapApproval(
  row: typeof approvalRequests.$inferSelect,
): ApprovalRequest {
  return approvalRequestSchema.parse({
    id: row.id,
    jobId: row.jobId,
    runId: row.runId,
    risk: row.risk,
    summary: row.summary,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  })
}

function mapArtifact(row: typeof artifacts.$inferSelect): Artifact {
  return artifactSchema.parse({
    id: row.id,
    jobId: row.jobId,
    type: row.type,
    title: row.title,
    storagePath: row.storagePath,
    createdAt: row.createdAt,
  })
}

function mapJobWorktree(row: typeof jobWorktrees.$inferSelect): JobWorktree {
  return jobWorktreeSchema.parse({
    id: row.id,
    jobId: row.jobId,
    repositoryId: row.repositoryId,
    worktreeRelPath: row.worktreeRelPath,
    branchName: row.branchName,
    baseCommit: row.baseCommit,
    includeDirtyPatch: row.includeDirtyPatch,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function parseCatalogProviderId(value: string) {
  if (!isProviderId(value)) {
    throw new Error(`Unknown provider id: ${value}`)
  }
  return value
}

function parseRuntimeProviderId(value: string) {
  if (!isRuntimeProviderId(value)) {
    throw new Error(`Unknown runtime provider id: ${value}`)
  }
  return value
}

function parseOptionalProviderId(value: string | null) {
  return value === null ? null : parseCatalogProviderId(value)
}

function isGrowthApplicationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : String(error)
  return (
    message.includes('growth_applications') &&
    (/SQLITE_CONSTRAINT/i.test(code) ||
      /unique constraint failed/i.test(message))
  )
}
