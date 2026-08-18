import { randomUUID } from 'node:crypto'
import {
  AppError,
  approvalRequestSchema,
  artifactSchema,
  employeeSchema,
  growthRecordSchema,
  installedPackSchema,
  isProviderId,
  isRuntimeProviderId,
  isShikumiEventType,
  jobSchema,
  persistedEventSchema,
  providerSchema,
  providerSessionSchema,
  runSchema,
  redactSensitiveText,
  sanitizeEventPayload,
  workspaceSchema,
  type ApprovalRequest,
  type ApprovalStatus,
  type Artifact,
  type AuditEntry,
  type Employee,
  type EmployeeInstance,
  type GrowthRecord,
  type InstalledPack,
  type Job,
  type PersistedEvent,
  type Provider,
  type ProviderSession,
  type ProviderSetting,
  type Repository,
  type Run,
  type UserQuestion,
  type Workspace,
  type WorldUnlock,
} from '@sikumi-local/core'
import { eq } from 'drizzle-orm'
import type { GitInspection } from '../workspaces/git-repository.js'
import type { AppDatabase } from './database.js'
import {
  approvalRequests,
  artifacts,
  auditEntries,
  employeeInstances,
  employees,
  events,
  growthRecords,
  installedPacks,
  jobs,
  providerSessions,
  providerSettings,
  providers,
  repositories,
  runs,
  userQuestions,
  workspaces,
  worldUnlocks,
} from './schema.js'

const DEFAULT_WORLD_PACK_ID = 'dog-office'

export interface AppStore {
  listWorkspaces(): Workspace[]
  getWorkspace(id: string): Workspace | undefined
  findRepositoryByAbsolutePath(absolutePath: string): Repository | undefined
  createWorkspace(inspection: GitInspection): Workspace
  updateWorkspace(
    id: string,
    patch: Partial<Pick<Workspace, 'defaultProviderId'>>,
  ): Workspace
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
  insertWorldUnlock(unlock: WorldUnlock): WorldUnlock
  insertAuditEntry(entry: AuditEntry): AuditEntry
  insertPack(pack: InstalledPack): InstalledPack
  listPacks(): InstalledPack[]
}

export function createStore(db: AppDatabase): AppStore {
  return {
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

    createWorkspace(inspection) {
      const now = new Date().toISOString()
      const workspaceId = randomUUID()
      const repositoryId = randomUUID()

      db.transaction((tx) => {
        tx.insert(workspaces)
          .values({
            id: workspaceId,
            name: inspection.displayName,
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

    updateWorkspace(id, patch) {
      const current = this.getWorkspace(id)
      if (!current) {
        throw new AppError('NOT_FOUND', 'Workspaceが見つかりません', 404)
      }
      const next = workspaceSchema.parse({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      })
      db.update(workspaces)
        .set({
          defaultProviderId: next.defaultProviderId,
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
          installedAt: parsed.installedAt,
        })
        .run()
      return parsed
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
            installedAt: row.installedAt,
          }),
        )
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
