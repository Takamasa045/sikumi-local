import { randomUUID } from 'node:crypto'
import {
  AppError,
  approvalRequestSchema,
  artifactSchema,
  employeeSchema,
  growthRecordSchema,
  installedPackSchema,
  isProviderId,
  isShikumiEventType,
  jobSchema,
  persistedEventSchema,
  providerSchema,
  providerSessionSchema,
  runSchema,
  sanitizeEventPayload,
  workspaceSchema,
  type ApprovalRequest,
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
  listProviders(): Provider[]
  insertEmployee(employee: Employee): Employee
  listEmployees(): Employee[]
  insertEmployeeInstance(instance: EmployeeInstance): EmployeeInstance
  insertProviderSetting(setting: ProviderSetting): ProviderSetting
  insertJob(job: Job): Job
  getJob(id: string): Job | undefined
  insertRun(run: Run): Run
  listRuns(jobId: string): Run[]
  insertProviderSession(session: ProviderSession): ProviderSession
  insertEvent(event: PersistedEvent): PersistedEvent
  listEvents(jobId: string): PersistedEvent[]
  insertApproval(approval: ApprovalRequest): ApprovalRequest
  insertQuestion(question: UserQuestion): UserQuestion
  insertArtifact(artifact: Artifact): Artifact
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

    listProviders() {
      return db
        .select()
        .from(providers)
        .all()
        .map((row) =>
          providerSchema.parse({
            id: parseProviderId(row.id),
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

    listRuns(jobId) {
      return db
        .select()
        .from(runs)
        .where(eq(runs.jobId, jobId))
        .all()
        .map(mapRun)
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
      return db
        .select()
        .from(events)
        .where(eq(events.jobId, jobId))
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
    },

    insertApproval(approval) {
      const parsed = approvalRequestSchema.parse(approval)
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

    insertArtifact(artifact) {
      const parsed = artifactSchema.parse(artifact)
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
    selectedProvider: parseProviderId(row.selectedProvider),
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
    providerId: parseProviderId(row.providerId),
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  })
}

function parseProviderId(value: string) {
  if (!isProviderId(value)) {
    throw new Error(`Unknown provider id: ${value}`)
  }
  return value
}

function parseOptionalProviderId(value: string | null) {
  return value === null ? null : parseProviderId(value)
}
