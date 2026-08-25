import {
  OBSERVER_STALE_AFTER_MS,
  OBSERVER_UI_MAX_CONFLICTS,
  clipList,
  displayNameForSource,
  type AttentionItem,
  type AttributionConfidence,
  type ConflictFinding,
  type ExternalSession,
  type ObservedWork,
  type ObserverAdapterRecord,
  type ResourceAction,
  type ResourceClaim,
} from '@sikumi-local/observer-core'
import { workDisplayName } from './situation.js'
import type { SituationGitInput } from './situation.js'

const WRITE_ACTIONS = new Set<ResourceAction>(['write', 'create', 'delete'])
const SAME_FILE_WRITE_EVIDENCE = new Set(['same-file', 'delete-edit'])
const STRONG_ATTRIBUTION = new Set<AttributionConfidence>([
  'verified',
  'correlated',
])
const NAMED_ATTRIBUTION = new Set<AttributionConfidence>([
  'verified',
  'reported',
  'correlated',
])
const SEVERITY_ORDER: Readonly<Record<AttentionItem['severity'], number>> = {
  red: 0,
  orange: 1,
  yellow: 2,
  info: 3,
}

export interface AttentionInput {
  readonly works: readonly ObservedWork[]
  readonly sessions: readonly ExternalSession[]
  readonly claims?: readonly ResourceClaim[]
  readonly conflicts?: readonly ConflictFinding[]
  readonly adapters?: readonly ObserverAdapterRecord[]
  readonly git?: readonly SituationGitInput[]
  readonly now?: number
}

export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const claims = input.claims ?? []
  const now = input.now ?? Date.now()
  const items = [
    ...waitingAttention(input.works, input.sessions),
    ...conflictAttention(input.conflicts ?? []),
    ...staleAttention(input.works, input.sessions, claims, now),
    ...unknownOwnerAttention(input.sessions, input.git ?? [], input.works),
    ...degradedAttention(input.adapters ?? []),
  ]
  return clipList(
    items.sort((left, right) => {
      const severity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      if (severity !== 0) {
        return severity
      }
      return right.occurredAt.localeCompare(left.occurredAt)
    }),
    OBSERVER_UI_MAX_CONFLICTS,
  ).items.slice()
}

export function isRedConflict(finding: ConflictFinding): boolean {
  if (finding.status === 'resolved') {
    return false
  }
  if (finding.level !== 'high' && finding.level !== 'critical') {
    return false
  }
  if (!hasSameFileWriteEvidence(finding)) {
    return false
  }
  return (
    STRONG_ATTRIBUTION.has(finding.leftAttributionConfidence) &&
    STRONG_ATTRIBUTION.has(finding.rightAttributionConfidence)
  )
}

function waitingAttention(
  works: readonly ObservedWork[],
  sessions: readonly ExternalSession[],
): AttentionItem[] {
  const waiting = [...works, ...sessionsToWorks(sessions, works)]
    .filter(isWaitingWork)
    .sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt))
  const seen = new Set<string>()
  const items: AttentionItem[] = []
  for (const work of waiting) {
    const key = `${work.repositoryId ?? ''}:${work.source}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    items.push({
      id: `waiting:${key}`,
      kind: 'waiting-for-user',
      severity: 'yellow',
      title: '確認待ち',
      summary: `${work.displayName}が確認を待っています`,
      repositoryId: work.repositoryId,
      source: work.source,
      workIds: [work.id],
      conflictId: null,
      evidence: ['確認を待っています'],
      attributionConfidence: work.attributionConfidence,
      occurredAt: work.lastObservedAt,
    })
  }
  return items
}

function conflictAttention(
  conflicts: readonly ConflictFinding[],
): AttentionItem[] {
  return conflicts.filter(isRedConflict).map((finding) => ({
    id: `conflict:${finding.id}`,
    kind: 'conflict' as const,
    severity: 'red' as const,
    title: '同じファイルを書いています',
    summary: finding.summary,
    repositoryId: finding.repositoryId,
    source: finding.leftSource,
    workIds: [finding.leftSessionId, finding.rightSessionId].filter(
      (value): value is string => Boolean(value),
    ),
    conflictId: finding.id,
    evidence: finding.evidence.map((item) => item.label),
    attributionConfidence: weakerConfidence(
      finding.leftAttributionConfidence,
      finding.rightAttributionConfidence,
    ),
    occurredAt: finding.updatedAt,
  }))
}

function staleAttention(
  works: readonly ObservedWork[],
  sessions: readonly ExternalSession[],
  claims: readonly ResourceClaim[],
  now: number,
): AttentionItem[] {
  const seen = new Set<string>()
  const items: AttentionItem[] = []
  for (const work of [...works, ...sessionsToWorks(sessions, works)]) {
    if (isWaitingWork(work) || work.source === 'git') {
      continue
    }
    if (!isClockStale(work, now)) {
      continue
    }
    if (seen.has(work.id)) {
      continue
    }
    seen.add(work.id)
    const lingering = isLingering(work, claims)
    items.push({
      id: `stale:${work.id}`,
      kind: 'stale-work',
      severity: 'yellow',
      title: lingering ? '途中のまま残っています' : '止まっている可能性があります',
      summary: lingering
        ? `${work.displayName}の仕事が、途中のまま居座っています`
        : `${work.displayName}から、しばらく様子が届いていません`,
      repositoryId: work.repositoryId,
      source: work.source,
      workIds: [work.id],
      conflictId: null,
      evidence: lingering
        ? ['一定時間動きがありません', '書きかけが残っています']
        : ['一定時間動きがありません'],
      attributionConfidence: work.attributionConfidence,
      occurredAt: work.lastObservedAt,
    })
  }
  return items
}

function unknownOwnerAttention(
  sessions: readonly ExternalSession[],
  git: readonly SituationGitInput[],
  works: readonly ObservedWork[],
): AttentionItem[] {
  const namedByRepo = new Set(
    works
      .filter(
        (work) =>
          work.repositoryId && NAMED_ATTRIBUTION.has(work.attributionConfidence),
      )
      .map((work) => work.repositoryId),
  )
  const unknownRepos = new Map<
    string,
    { readonly occurredAt: string; readonly confidence: AttributionConfidence }
  >()
  for (const session of sessions) {
    if (!session.repositoryId || namedByRepo.has(session.repositoryId)) {
      continue
    }
    const unknown =
      session.source === 'git' ||
      session.attributionConfidence === 'inferred' ||
      session.attributionConfidence === 'unknown'
    if (!unknown) {
      continue
    }
    const current = unknownRepos.get(session.repositoryId)
    if (!current || session.lastObservedAt > current.occurredAt) {
      unknownRepos.set(session.repositoryId, {
        occurredAt: session.lastObservedAt,
        confidence: session.attributionConfidence,
      })
    }
  }
  for (const snapshot of git) {
    if (namedByRepo.has(snapshot.repositoryId) || snapshot.changedFileCount <= 0) {
      continue
    }
    if (unknownRepos.has(snapshot.repositoryId)) {
      continue
    }
    unknownRepos.set(snapshot.repositoryId, {
      occurredAt: snapshot.scannedAt ?? new Date(0).toISOString(),
      confidence: 'inferred',
    })
  }
  return [...unknownRepos.entries()].map(([repositoryId, item]) => ({
    id: `unknown-owner:${repositoryId}`,
    kind: 'unknown-owner' as const,
    severity: 'yellow' as const,
    title: '誰の作業かまだ分かっていません',
    summary: '持ち主が分からない変更があります',
    repositoryId,
    source: null,
    workIds: [],
    conflictId: null,
    evidence: ['関連付けが弱い、または Git だけの変更です'],
    attributionConfidence: item.confidence,
    occurredAt: item.occurredAt,
  }))
}

function degradedAttention(
  adapters: readonly ObserverAdapterRecord[],
): AttentionItem[] {
  return adapters
    .filter(
      (adapter) =>
        adapter.source !== 'git' &&
        (adapter.installationStatus === 'degraded' ||
          adapter.health.status === 'degraded'),
    )
    .map((adapter) => {
      const hasErrors = adapter.health.errors.length > 0
      return {
        id: `observer-degraded:${adapter.source}`,
        kind: 'observer-degraded' as const,
        severity: hasErrors ? ('orange' as const) : ('yellow' as const),
        title: '観測が弱くなっています',
        summary: `${displayNameForSource(adapter.source)}の観測が劣化しています`,
        repositoryId: null,
        source: adapter.source,
        workIds: [],
        conflictId: null,
        evidence: hasErrors
          ? adapter.health.errors.slice(0, 8)
          : adapter.health.warnings.slice(0, 8),
        attributionConfidence: 'reported' as const,
        occurredAt: adapter.updatedAt,
      }
    })
}

function sessionsToWorks(
  sessions: readonly ExternalSession[],
  works: readonly ObservedWork[],
): ObservedWork[] {
  const known = new Set(works.map((work) => work.id))
  return sessions
    .filter((session) => !known.has(session.id) && session.source !== 'git')
    .map((session) => ({
      id: session.id,
      sessionId: session.id,
      source: session.source,
      surface: session.surface,
      displayName: workDisplayName(session),
      repositoryId: session.repositoryId,
      workspaceId: session.workspaceId,
      title: session.title,
      activity: session.activity,
      status: session.status,
      attributionConfidence: session.attributionConfidence,
      claimedPaths: [],
      lastObservedAt: session.lastObservedAt,
      startedAt: session.startedAt,
    }))
}

function isWaitingWork(work: Pick<ObservedWork, 'status' | 'activity'>): boolean {
  return (
    work.status === 'waiting-for-user' || work.activity === 'waiting-for-user'
  )
}

function isClockStale(
  work: Pick<ObservedWork, 'status' | 'lastObservedAt'>,
  now: number,
): boolean {
  if (work.status === 'stale') {
    return true
  }
  const last = Date.parse(work.lastObservedAt)
  return !Number.isNaN(last) && now - last >= OBSERVER_STALE_AFTER_MS
}

function isLingering(
  work: Pick<ObservedWork, 'id' | 'activity' | 'status'>,
  claims: readonly ResourceClaim[],
): boolean {
  const held = claims.some(
    (claim) =>
      claim.externalSessionId === work.id && WRITE_ACTIONS.has(claim.action),
  )
  if (held) {
    return true
  }
  return work.activity === 'idle' || work.status === 'idle'
}

function hasSameFileWriteEvidence(finding: ConflictFinding): boolean {
  return finding.evidence.some((item) => SAME_FILE_WRITE_EVIDENCE.has(item.kind))
}

function weakerConfidence(
  left: AttributionConfidence,
  right: AttributionConfidence,
): AttributionConfidence {
  const order: AttributionConfidence[] = [
    'unknown',
    'inferred',
    'correlated',
    'reported',
    'verified',
  ]
  return order.indexOf(left) <= order.indexOf(right) ? left : right
}
