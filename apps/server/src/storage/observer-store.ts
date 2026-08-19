import { randomUUID } from 'node:crypto'
import {
  conflictFindingSchema,
  externalSessionSchema,
  normalizedObserverEventSchema,
  observerAdapterRecordSchema,
  observerHealthSchema,
  resourceClaimSchema,
  sessionLabelSchema,
  type ConflictFinding,
  type ExternalSession,
  type NormalizedObserverEvent,
  type ObserverAdapterRecord,
  type ResourceClaim,
  type SessionLabel,
} from '@sikumi-local/observer-core'
import { AppError } from '@sikumi-local/core'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from './database.js'
import {
  conflictFindings,
  externalSessions,
  observerAdapters,
  observerEvents,
  repositories,
  repositorySnapshots,
  resourceClaims,
  sessionLabels,
} from './schema.js'

export interface StoredRepositorySnapshot {
  readonly id: string
  readonly repositoryId: string
  readonly worktreePath: string
  readonly branch: string | null
  readonly headCommit: string | null
  readonly baseCommit: string | null
  readonly status: Record<string, unknown>
  readonly changedFiles: readonly unknown[]
  readonly createdAt: string
}

export interface RegisteredRepository {
  readonly id: string
  readonly workspaceId: string
  readonly absolutePath: string
  readonly displayName: string
  readonly currentBranch: string | null
  readonly readable: boolean
}

export interface ObserverStore {
  listRegisteredRepositories(): RegisteredRepository[]
  getRegisteredRepository(id: string): RegisteredRepository | undefined
  upsertAdapter(record: ObserverAdapterRecord): ObserverAdapterRecord
  listAdapters(): ObserverAdapterRecord[]
  getAdapter(source: string): ObserverAdapterRecord | undefined
  insertObserverEvent(
    event: NormalizedObserverEvent,
    bound?: { readonly sessionId?: string | null },
  ): { readonly inserted: boolean; readonly event: NormalizedObserverEvent }
  getObserverEvent(id: string): NormalizedObserverEvent | undefined
  findObserverEventByIdempotency(
    key: string,
  ): NormalizedObserverEvent | undefined
  listObserverEvents(filter?: {
    readonly sessionId?: string
    readonly repositoryId?: string
  }): NormalizedObserverEvent[]
  upsertExternalSession(session: ExternalSession): ExternalSession
  getExternalSession(id: string): ExternalSession | undefined
  findExternalSession(filter: {
    readonly source: string
    readonly externalSessionId?: string | null
    readonly repositoryId?: string | null
    readonly worktreePath?: string | null
  }): ExternalSession | undefined
  listExternalSessions(filter?: {
    readonly repositoryId?: string
  }): ExternalSession[]
  upsertResourceClaim(claim: ResourceClaim): ResourceClaim
  listResourceClaims(filter?: {
    readonly repositoryId?: string
    readonly sessionId?: string
  }): ResourceClaim[]
  insertRepositorySnapshot(
    snapshot: StoredRepositorySnapshot,
  ): StoredRepositorySnapshot
  listRepositorySnapshots(repositoryId: string): StoredRepositorySnapshot[]
  latestSnapshotsByRepository(repositoryId: string): StoredRepositorySnapshot[]
  upsertConflict(finding: ConflictFinding): ConflictFinding
  listConflicts(filter?: {
    readonly repositoryId?: string
    readonly source?: string
    readonly level?: string
    readonly status?: string
    readonly unconfirmed?: boolean
  }): ConflictFinding[]
  getConflict(id: string): ConflictFinding | undefined
  upsertSessionLabel(label: SessionLabel): SessionLabel
  getSessionLabel(sessionId: string): SessionLabel | undefined
}

export function createObserverStore(db: AppDatabase): ObserverStore {
  return {
    listRegisteredRepositories() {
      return db
        .select()
        .from(repositories)
        .all()
        .filter((row) => !row.absolutePath.startsWith('unlinked:'))
        .map((row) => ({
          id: row.id,
          workspaceId: row.workspaceId,
          absolutePath: row.absolutePath,
          displayName: row.displayName,
          currentBranch: row.currentBranch,
          readable: row.readable,
        }))
    },

    getRegisteredRepository(id) {
      return this.listRegisteredRepositories().find((row) => row.id === id)
    },

    upsertAdapter(record) {
      const parsed = observerAdapterRecordSchema.parse(record)
      const existing = this.getAdapter(parsed.source)
      if (existing) {
        db.update(observerAdapters)
          .set({
            displayName: parsed.displayName,
            enabled: parsed.enabled,
            installationStatus: parsed.installationStatus,
            installedVersion: parsed.installedVersion,
            detectedVersion: parsed.detectedVersion,
            lastEventAt: parsed.lastEventAt,
            healthJson: JSON.stringify(parsed.health),
            updatedAt: parsed.updatedAt,
          })
          .where(eq(observerAdapters.source, parsed.source))
          .run()
        return parsed
      }
      db.insert(observerAdapters)
        .values({
          id: parsed.id,
          source: parsed.source,
          displayName: parsed.displayName,
          enabled: parsed.enabled,
          installationStatus: parsed.installationStatus,
          installedVersion: parsed.installedVersion,
          detectedVersion: parsed.detectedVersion,
          lastEventAt: parsed.lastEventAt,
          healthJson: JSON.stringify(parsed.health),
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        })
        .run()
      return parsed
    },

    listAdapters() {
      return db
        .select()
        .from(observerAdapters)
        .all()
        .map(mapAdapter)
    },

    getAdapter(source) {
      const row = db
        .select()
        .from(observerAdapters)
        .where(eq(observerAdapters.source, source))
        .get()
      return row ? mapAdapter(row) : undefined
    },

    insertObserverEvent(event, bound) {
      const parsed = normalizedObserverEventSchema.parse(event)
      const existing = this.findObserverEventByIdempotency(parsed.idempotencyKey)
      if (existing) {
        return { inserted: false, event: existing }
      }
      try {
        db.insert(observerEvents)
          .values({
            id: parsed.id,
            externalSessionId: bound?.sessionId ?? parsed.externalSessionId,
            repositoryId: parsed.repositoryId,
            source: parsed.source,
            nativeEventType: parsed.nativeEventType,
            normalizedType: parsed.normalizedType,
            payloadJson: JSON.stringify({
              payload: parsed.payload,
              summary: parsed.summary,
              activity: parsed.activity,
              actorKind: parsed.actorKind,
              surface: parsed.surface,
              cwd: parsed.cwd,
              worktreePath: parsed.worktreePath,
              branch: parsed.branch,
              externalTurnId: parsed.externalTurnId,
              externalTaskId: parsed.externalTaskId,
              externalSubagentId: parsed.externalSubagentId,
              baseCommit: parsed.baseCommit,
              headCommit: parsed.headCommit,
              attributionConfidence: parsed.attributionConfidence,
              ingestionMethod: parsed.ingestionMethod,
              resource: parsed.resource,
            }),
            occurredAt: parsed.occurredAt,
            receivedAt: parsed.receivedAt,
            idempotencyKey: parsed.idempotencyKey,
          })
          .run()
        return { inserted: true, event: parsed }
      } catch (error) {
        if (isUniqueConflict(error, 'idempotency_key')) {
          const again = this.findObserverEventByIdempotency(parsed.idempotencyKey)
          if (again) {
            return { inserted: false, event: again }
          }
        }
        throw error
      }
    },

    getObserverEvent(id) {
      const row = db
        .select()
        .from(observerEvents)
        .where(eq(observerEvents.id, id))
        .get()
      return row ? mapEvent(row) : undefined
    },

    findObserverEventByIdempotency(key) {
      const row = db
        .select()
        .from(observerEvents)
        .where(eq(observerEvents.idempotencyKey, key))
        .get()
      return row ? mapEvent(row) : undefined
    },

    listObserverEvents(filter) {
      return db
        .select()
        .from(observerEvents)
        .all()
        .filter((row) => {
          if (filter?.sessionId && row.externalSessionId !== filter.sessionId) {
            return false
          }
          if (filter?.repositoryId && row.repositoryId !== filter.repositoryId) {
            return false
          }
          return true
        })
        .map(mapEvent)
        .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    },

    upsertExternalSession(session) {
      const parsed = externalSessionSchema.parse(session)
      const existing = this.getExternalSession(parsed.id)
      if (existing) {
        db.update(externalSessions)
          .set({
            source: parsed.source,
            surface: parsed.surface,
            externalSessionId: parsed.externalSessionId,
            workspaceId: parsed.workspaceId,
            repositoryId: parsed.repositoryId,
            cwd: parsed.cwd,
            worktreePath: parsed.worktreePath,
            branch: parsed.branch,
            baseCommit: parsed.baseCommit,
            headCommit: parsed.headCommit,
            title: parsed.title,
            status: parsed.status,
            activity: parsed.activity,
            attributionConfidence: parsed.attributionConfidence,
            lastObservedAt: parsed.lastObservedAt,
            endedAt: parsed.endedAt,
          })
          .where(eq(externalSessions.id, parsed.id))
          .run()
        return parsed
      }
      db.insert(externalSessions)
        .values({
          id: parsed.id,
          source: parsed.source,
          surface: parsed.surface,
          externalSessionId: parsed.externalSessionId,
          workspaceId: parsed.workspaceId,
          repositoryId: parsed.repositoryId,
          cwd: parsed.cwd,
          worktreePath: parsed.worktreePath,
          branch: parsed.branch,
          baseCommit: parsed.baseCommit,
          headCommit: parsed.headCommit,
          title: parsed.title,
          status: parsed.status,
          activity: parsed.activity,
          attributionConfidence: parsed.attributionConfidence,
          startedAt: parsed.startedAt,
          lastObservedAt: parsed.lastObservedAt,
          endedAt: parsed.endedAt,
        })
        .run()
      return parsed
    },

    getExternalSession(id) {
      const row = db
        .select()
        .from(externalSessions)
        .where(eq(externalSessions.id, id))
        .get()
      return row ? mapSession(row) : undefined
    },

    findExternalSession(filter) {
      return this.listExternalSessions()
        .filter((session) => session.source === filter.source)
        .find((session) => {
          if (filter.externalSessionId) {
            return session.externalSessionId === filter.externalSessionId
          }
          if (filter.worktreePath) {
            return session.worktreePath === filter.worktreePath
          }
          if (filter.repositoryId) {
            return (
              session.repositoryId === filter.repositoryId &&
              session.externalSessionId === null
            )
          }
          return false
        })
    },

    listExternalSessions(filter) {
      return db
        .select()
        .from(externalSessions)
        .all()
        .map(mapSession)
        .filter((session) => {
          if (filter?.repositoryId && session.repositoryId !== filter.repositoryId) {
            return false
          }
          return true
        })
        .sort((left, right) =>
          right.lastObservedAt.localeCompare(left.lastObservedAt),
        )
    },

    upsertResourceClaim(claim) {
      const parsed = resourceClaimSchema.parse(claim)
      const existing = this.listResourceClaims({
        ...(parsed.repositoryId ? { repositoryId: parsed.repositoryId } : {}),
        ...(parsed.externalSessionId
          ? { sessionId: parsed.externalSessionId }
          : {}),
      }).find(
        (item) =>
          item.resourceType === parsed.resourceType &&
          item.resourceKey === parsed.resourceKey &&
          item.action === parsed.action &&
          item.claimKind === parsed.claimKind,
      )
      if (existing) {
        db.update(resourceClaims)
          .set({
            lastObservedAt: parsed.lastObservedAt,
            confidence: parsed.confidence,
          })
          .where(eq(resourceClaims.id, existing.id))
          .run()
        return { ...existing, lastObservedAt: parsed.lastObservedAt }
      }
      db.insert(resourceClaims)
        .values({
          id: parsed.id,
          externalSessionId: parsed.externalSessionId,
          repositoryId: parsed.repositoryId,
          resourceType: parsed.resourceType,
          resourceKey: parsed.resourceKey,
          action: parsed.action,
          claimKind: parsed.claimKind,
          confidence: parsed.confidence,
          firstObservedAt: parsed.firstObservedAt,
          lastObservedAt: parsed.lastObservedAt,
        })
        .run()
      return parsed
    },

    listResourceClaims(filter) {
      return db
        .select()
        .from(resourceClaims)
        .all()
        .map(mapClaim)
        .filter((claim) => {
          if (filter?.repositoryId && claim.repositoryId !== filter.repositoryId) {
            return false
          }
          if (filter?.sessionId && claim.externalSessionId !== filter.sessionId) {
            return false
          }
          return true
        })
    },

    insertRepositorySnapshot(snapshot) {
      const latest = this.latestSnapshotsByRepository(snapshot.repositoryId).find(
        (item) => item.worktreePath === snapshot.worktreePath,
      )
      if (latest && sameSnapshotContent(latest, snapshot)) {
        return latest
      }
      db.insert(repositorySnapshots)
        .values({
          id: snapshot.id,
          repositoryId: snapshot.repositoryId,
          worktreePath: snapshot.worktreePath,
          branch: snapshot.branch,
          headCommit: snapshot.headCommit,
          baseCommit: snapshot.baseCommit,
          statusJson: JSON.stringify(snapshot.status),
          changedFilesJson: JSON.stringify(snapshot.changedFiles),
          createdAt: snapshot.createdAt,
        })
        .run()
      return snapshot
    },

    listRepositorySnapshots(repositoryId) {
      return db
        .select()
        .from(repositorySnapshots)
        .all()
        .filter((row) => row.repositoryId === repositoryId)
        .map(mapSnapshot)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    },

    latestSnapshotsByRepository(repositoryId) {
      const latest = new Map<string, StoredRepositorySnapshot>()
      for (const snapshot of this.listRepositorySnapshots(repositoryId)) {
        if (!latest.has(snapshot.worktreePath)) {
          latest.set(snapshot.worktreePath, snapshot)
        }
      }
      return [...latest.values()]
    },

    upsertConflict(finding) {
      const parsed = conflictFindingSchema.parse(finding)
      const existing =
        this.getConflict(parsed.id) ??
        this.listConflicts({ repositoryId: parsed.repositoryId }).find(
          (item) => item.identityKey === parsed.identityKey,
        )
      if (existing) {
        db.update(conflictFindings)
          .set({
            leftSessionId: parsed.leftSessionId,
            rightSessionId: parsed.rightSessionId,
            leftWorktreePath: parsed.leftWorktreePath,
            rightWorktreePath: parsed.rightWorktreePath,
            leftSource: parsed.leftSource,
            rightSource: parsed.rightSource,
            leftAttributionConfidence: parsed.leftAttributionConfidence,
            rightAttributionConfidence: parsed.rightAttributionConfidence,
            level: parsed.level,
            score: parsed.score,
            confidence: parsed.confidence,
            headline: parsed.headline,
            summary: parsed.summary,
            recommendation: parsed.recommendation,
            reasonJson: JSON.stringify(parsed.reasons),
            evidenceJson: JSON.stringify(parsed.evidence),
            identityKey: parsed.identityKey,
            fingerprint: parsed.fingerprint,
            status: parsed.status,
            updatedAt: parsed.updatedAt,
            resolvedAt: parsed.resolvedAt,
          })
          .where(eq(conflictFindings.id, existing.id))
          .run()
        const updated = this.getConflict(existing.id)
        if (!updated) {
          throw new AppError('NOT_FOUND', '競合の保存に失敗しました', 500)
        }
        return updated
      }
      db.insert(conflictFindings)
        .values({
          id: parsed.id,
          repositoryId: parsed.repositoryId,
          leftSessionId: parsed.leftSessionId,
          rightSessionId: parsed.rightSessionId,
          leftWorktreePath: parsed.leftWorktreePath,
          rightWorktreePath: parsed.rightWorktreePath,
          leftSource: parsed.leftSource,
          rightSource: parsed.rightSource,
          leftAttributionConfidence: parsed.leftAttributionConfidence,
          rightAttributionConfidence: parsed.rightAttributionConfidence,
          level: parsed.level,
          score: parsed.score,
          confidence: parsed.confidence,
          headline: parsed.headline,
          summary: parsed.summary,
          recommendation: parsed.recommendation,
          reasonJson: JSON.stringify(parsed.reasons),
          evidenceJson: JSON.stringify(parsed.evidence),
          identityKey: parsed.identityKey,
          fingerprint: parsed.fingerprint,
          status: parsed.status,
          detectedAt: parsed.detectedAt,
          updatedAt: parsed.updatedAt,
          resolvedAt: parsed.resolvedAt,
        })
        .run()
      const inserted = this.getConflict(parsed.id)
      if (!inserted) {
        throw new AppError('NOT_FOUND', '競合の保存に失敗しました', 500)
      }
      return inserted
    },

    listConflicts(filter) {
      return db
        .select()
        .from(conflictFindings)
        .all()
        .map(mapConflict)
        .filter((item) => {
          if (filter?.repositoryId && item.repositoryId !== filter.repositoryId) {
            return false
          }
          if (filter?.level && item.level !== filter.level) {
            return false
          }
          if (filter?.status && item.status !== filter.status) {
            return false
          }
          if (filter?.unconfirmed && item.status !== 'open') {
            return false
          }
          if (
            filter?.source &&
            item.leftSource !== filter.source &&
            item.rightSource !== filter.source
          ) {
            return false
          }
          return true
        })
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score
          }
          return left.identityKey.localeCompare(right.identityKey)
        })
    },

    getConflict(id) {
      const row = db
        .select()
        .from(conflictFindings)
        .where(eq(conflictFindings.id, id))
        .get()
      return row ? mapConflict(row) : undefined
    },

    upsertSessionLabel(label) {
      const parsed = sessionLabelSchema.parse(label)
      const existing = this.getSessionLabel(parsed.externalSessionId)
      if (existing) {
        db.update(sessionLabels)
          .set({
            title: parsed.title,
            summary: parsed.summary,
            source: parsed.source,
            updatedAt: parsed.updatedAt,
          })
          .where(eq(sessionLabels.externalSessionId, parsed.externalSessionId))
          .run()
        return { ...parsed, id: existing.id, createdAt: existing.createdAt }
      }
      db.insert(sessionLabels)
        .values({
          id: parsed.id,
          externalSessionId: parsed.externalSessionId,
          title: parsed.title,
          summary: parsed.summary,
          source: parsed.source,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
        })
        .run()
      return parsed
    },

    getSessionLabel(sessionId) {
      const row = db
        .select()
        .from(sessionLabels)
        .where(eq(sessionLabels.externalSessionId, sessionId))
        .get()
      return row ? mapLabel(row) : undefined
    },
  }
}

export function createObserverId(): string {
  return randomUUID()
}

function mapAdapter(
  row: typeof observerAdapters.$inferSelect,
): ObserverAdapterRecord {
  return observerAdapterRecordSchema.parse({
    id: row.id,
    source: row.source,
    displayName: row.displayName,
    enabled: Boolean(row.enabled),
    installationStatus: row.installationStatus,
    installedVersion: row.installedVersion,
    detectedVersion: row.detectedVersion,
    lastEventAt: row.lastEventAt,
    health: observerHealthSchema.parse(JSON.parse(row.healthJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function mapEvent(
  row: typeof observerEvents.$inferSelect,
): NormalizedObserverEvent {
  const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
  return normalizedObserverEventSchema.parse({
    id: row.id,
    schemaVersion: 1,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
    source: row.source,
    surface: payload.surface ?? 'unknown',
    nativeEventType: row.nativeEventType,
    normalizedType: row.normalizedType,
    externalSessionId: row.externalSessionId,
    externalTurnId: readNullableText(payload.externalTurnId),
    externalTaskId: readNullableText(payload.externalTaskId),
    externalSubagentId: readNullableText(payload.externalSubagentId),
    cwd: payload.cwd ?? null,
    repositoryId: row.repositoryId,
    worktreePath: payload.worktreePath ?? null,
    branch: payload.branch ?? null,
    baseCommit: readNullableText(payload.baseCommit),
    headCommit: readNullableText(payload.headCommit),
    actorKind: payload.actorKind ?? 'unknown',
    activity: payload.activity ?? 'unknown',
    resource: payload.resource ?? null,
    summary: payload.summary ?? null,
    attributionConfidence: payload.attributionConfidence ?? 'unknown',
    ingestionMethod: payload.ingestionMethod ?? 'http',
    idempotencyKey: row.idempotencyKey,
    payload: payload.payload ?? {},
  })
}

function mapSession(row: typeof externalSessions.$inferSelect): ExternalSession {
  return externalSessionSchema.parse({
    id: row.id,
    source: row.source,
    surface: row.surface,
    externalSessionId: row.externalSessionId,
    workspaceId: row.workspaceId,
    repositoryId: row.repositoryId,
    cwd: row.cwd,
    worktreePath: row.worktreePath,
    branch: row.branch,
    baseCommit: row.baseCommit,
    headCommit: row.headCommit,
    title: row.title,
    status: row.status,
    activity: row.activity,
    attributionConfidence: row.attributionConfidence,
    startedAt: row.startedAt,
    lastObservedAt: row.lastObservedAt,
    endedAt: row.endedAt,
  })
}

function mapClaim(row: typeof resourceClaims.$inferSelect): ResourceClaim {
  return resourceClaimSchema.parse({
    id: row.id,
    externalSessionId: row.externalSessionId,
    repositoryId: row.repositoryId,
    resourceType: row.resourceType,
    resourceKey: row.resourceKey,
    action: row.action,
    claimKind: row.claimKind,
    confidence: row.confidence,
    firstObservedAt: row.firstObservedAt,
    lastObservedAt: row.lastObservedAt,
  })
}

function mapSnapshot(
  row: typeof repositorySnapshots.$inferSelect,
): StoredRepositorySnapshot {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    worktreePath: row.worktreePath,
    branch: row.branch,
    headCommit: row.headCommit,
    baseCommit: row.baseCommit,
    status: JSON.parse(row.statusJson) as Record<string, unknown>,
    changedFiles: JSON.parse(row.changedFilesJson) as unknown[],
    createdAt: row.createdAt,
  }
}

function mapConflict(row: typeof conflictFindings.$inferSelect): ConflictFinding {
  return conflictFindingSchema.parse({
    id: row.id,
    identityKey: row.identityKey ?? row.id,
    repositoryId: row.repositoryId,
    leftSessionId: row.leftSessionId,
    rightSessionId: row.rightSessionId,
    leftWorktreePath: row.leftWorktreePath,
    rightWorktreePath: row.rightWorktreePath,
    leftSource: row.leftSource ?? null,
    rightSource: row.rightSource ?? null,
    leftAttributionConfidence: row.leftAttributionConfidence ?? 'unknown',
    rightAttributionConfidence: row.rightAttributionConfidence ?? 'unknown',
    level: row.level,
    score: row.score,
    confidence: row.confidence,
    headline: row.headline ?? row.summary,
    summary: row.summary,
    recommendation: row.recommendation ?? 'こちらから自動操作はしません。',
    reasons: JSON.parse(row.reasonJson) as string[],
    evidence: readEvidence(row.evidenceJson),
    fingerprint: row.fingerprint ?? row.id,
    status: row.status,
    detectedAt: row.detectedAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  })
}

function mapLabel(row: typeof sessionLabels.$inferSelect): SessionLabel {
  return sessionLabelSchema.parse({
    id: row.id,
    externalSessionId: row.externalSessionId,
    title: row.title,
    summary: row.summary,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

function readEvidence(raw: string | null): ConflictFinding['evidence'] {
  const parsed = JSON.parse(raw ?? '[]') as Array<{
    kind?: unknown
    label?: unknown
    leftPath?: unknown
    rightPath?: unknown
  }>
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed.flatMap((item) => {
    if (typeof item.kind !== 'string' || typeof item.label !== 'string') {
      return []
    }
    return [
      {
        kind: item.kind,
        label: item.label,
        ...(typeof item.leftPath === 'string' ? { leftPath: item.leftPath } : {}),
        ...(typeof item.rightPath === 'string' ? { rightPath: item.rightPath } : {}),
      },
    ]
  })
}

function isUniqueConflict(error: unknown, column: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE/i.test(message) && message.includes(column)
}

function sameSnapshotContent(
  left: StoredRepositorySnapshot,
  right: StoredRepositorySnapshot,
): boolean {
  return (
    left.branch === right.branch &&
    left.headCommit === right.headCommit &&
    left.baseCommit === right.baseCommit &&
    JSON.stringify(left.status) === JSON.stringify(right.status) &&
    JSON.stringify(left.changedFiles) === JSON.stringify(right.changedFiles)
  )
}

function readNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function missingSession(id: string): never {
  throw new AppError('NOT_FOUND', `外部セッションが見つかりません: ${id}`, 404)
}