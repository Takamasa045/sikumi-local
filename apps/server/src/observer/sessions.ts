import {
  createObserverEventId,
  OBSERVER_STALE_AFTER_MS,
  type ExternalSession,
  type ExternalSessionStatus,
  type NormalizedObserverEvent,
} from '@sikumi-local/observer-core'
import { matchLongestObservedRoot } from '@sikumi-local/observer-git'
import type { CombinedStore } from '../storage/store.js'
import type { RegisteredRepository } from '../storage/observer-store.js'
import { createObserverId } from '../storage/observer-store.js'

export { OBSERVER_STALE_AFTER_MS }

export function correlateRepository(
  event: NormalizedObserverEvent,
  repositories: readonly RegisteredRepository[],
  discoveredWorktrees: Readonly<Record<string, readonly string[]>> = {},
): {
  repository: RegisteredRepository
  confidence: NormalizedObserverEvent['attributionConfidence']
} | null {
  if (event.repositoryId) {
    const exact = repositories.find((item) => item.id === event.repositoryId)
    if (exact) {
      return { repository: exact, confidence: event.attributionConfidence }
    }
  }

  const candidates = [event.cwd, event.worktreePath].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  if (candidates.length === 0) {
    return null
  }

  type Match = {
    repository: RegisteredRepository
    confidence: NormalizedObserverEvent['attributionConfidence']
    length: number
  }
  let best: Match | null = null

  for (const repository of repositories) {
    const worktreeRoots = discoveredWorktrees[repository.id] ?? []
    const worktreeHit =
      matchLongestObservedRoot(candidates[0] ?? null, worktreeRoots) ??
      matchLongestObservedRoot(candidates[1] ?? null, worktreeRoots)
    if (worktreeHit) {
      const next: Match = {
        repository,
        confidence: confidenceFor(event, 'verified'),
        length: worktreeHit.length,
      }
      if (!best || next.length > best.length) {
        best = next
      }
      continue
    }

    const rootHit =
      matchLongestObservedRoot(candidates[0] ?? null, [
        repository.absolutePath,
      ]) ??
      matchLongestObservedRoot(candidates[1] ?? null, [repository.absolutePath])
    if (rootHit) {
      const next: Match = {
        repository,
        confidence: confidenceFor(event, 'verified'),
        length: rootHit.length,
      }
      if (!best || next.length > best.length) {
        best = next
      }
    }
  }

  return best
    ? { repository: best.repository, confidence: best.confidence }
    : null
}

function confidenceFor(
  event: NormalizedObserverEvent,
  matched: 'verified' | 'correlated',
): NormalizedObserverEvent['attributionConfidence'] {
  if (event.source === 'git') {
    return 'inferred'
  }
  if (event.source === 'claude-desktop') {
    return 'reported'
  }
  return matched
}

export function nextSessionStatus(
  event: NormalizedObserverEvent,
  current?: ExternalSessionStatus,
): ExternalSessionStatus {
  switch (event.normalizedType) {
    case 'session.started':
      return 'active'
    case 'session.ended':
      return event.source === 'claude-desktop' ? 'completed' : 'ended'
    case 'session.failed':
      return 'failed'
    case 'permission.requested':
    case 'user.input_required':
      return 'waiting-for-user'
    case 'heartbeat':
      return current === 'waiting-for-user' ? 'waiting-for-user' : 'idle'
    case 'task.completed':
      return current === 'active' ? 'active' : (current ?? 'detected')
    default:
      return current && current !== 'ended' && current !== 'failed'
        ? current === 'detected'
          ? 'active'
          : current
        : 'active'
  }
}

export function upsertSessionFromEvent(
  store: CombinedStore,
  event: NormalizedObserverEvent,
  repositories: readonly RegisteredRepository[],
  discoveredWorktrees: Readonly<Record<string, readonly string[]>> = {},
): { session: ExternalSession; event: NormalizedObserverEvent } {
  const correlated = correlateRepository(
    event,
    repositories,
    discoveredWorktrees,
  )
  const repository = correlated?.repository
  const existing =
    (event.externalSessionId
      ? store.findExternalSession({
          source: event.source,
          externalSessionId: event.externalSessionId,
        })
      : undefined) ??
    (repository
      ? store.findExternalSession({
          source: event.source,
          repositoryId: repository.id,
          worktreePath: event.worktreePath,
        })
      : undefined)

  const session: ExternalSession = existing
    ? {
        ...existing,
        surface: event.surface !== 'unknown' ? event.surface : existing.surface,
        cwd: event.cwd ?? existing.cwd,
        worktreePath: event.worktreePath ?? existing.worktreePath,
        branch: event.branch ?? existing.branch,
        baseCommit: event.baseCommit ?? existing.baseCommit,
        headCommit: event.headCommit ?? existing.headCommit,
        title: event.summary ?? existing.title,
        repositoryId: repository?.id ?? existing.repositoryId,
        workspaceId: repository?.workspaceId ?? existing.workspaceId,
        activity: event.activity,
        status: nextSessionStatus(event, existing.status),
        attributionConfidence:
          correlated?.confidence ?? existing.attributionConfidence,
        lastObservedAt: event.occurredAt,
        endedAt:
          event.normalizedType === 'session.ended' ||
          event.normalizedType === 'session.failed'
            ? event.occurredAt
            : existing.endedAt,
      }
    : {
        id: createObserverId(),
        source: event.source,
        surface: event.surface,
        externalSessionId: event.externalSessionId,
        workspaceId: repository?.workspaceId ?? null,
        repositoryId: repository?.id ?? null,
        cwd: event.cwd,
        worktreePath: event.worktreePath,
        branch: event.branch,
        baseCommit: event.baseCommit,
        headCommit: event.headCommit,
        title: event.summary,
        status: nextSessionStatus(event),
        activity: event.activity,
        attributionConfidence:
          correlated?.confidence ?? event.attributionConfidence,
        startedAt: event.occurredAt,
        lastObservedAt: event.occurredAt,
        endedAt:
          event.normalizedType === 'session.ended' ||
          event.normalizedType === 'session.failed'
            ? event.occurredAt
            : null,
      }

  const saved = store.upsertExternalSession(session)
  const boundEvent: NormalizedObserverEvent = {
    ...event,
    id: event.id || createObserverEventId(),
    repositoryId: saved.repositoryId,
    worktreePath: event.worktreePath ?? saved.worktreePath,
    attributionConfidence: saved.attributionConfidence,
  }
  return { session: saved, event: boundEvent }
}

export function markStaleSessions(
  store: CombinedStore,
  now = Date.now(),
): ExternalSession[] {
  const updated: ExternalSession[] = []
  for (const session of store.listExternalSessions()) {
    if (
      session.status === 'ended' ||
      session.status === 'failed' ||
      session.status === 'completed' ||
      session.status === 'stale'
    ) {
      continue
    }
    if (session.source === 'git') {
      continue
    }
    const last = Date.parse(session.lastObservedAt)
    if (Number.isNaN(last) || now - last < OBSERVER_STALE_AFTER_MS) {
      continue
    }
    updated.push(
      store.upsertExternalSession({
        ...session,
        status: 'stale',
      }),
    )
  }
  return updated
}
