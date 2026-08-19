import type { ExternalSession, ResourceClaim } from './types.js'

export const CURSOR_TAB_AGGREGATION_WINDOW_MS = 5 * 60_000

export interface AggregatedCursorTabGroup {
  readonly repositoryId: string | null
  readonly path: string
  readonly count: number
  readonly lastObservedAt: string
  readonly sessionIds: readonly string[]
}

export interface CursorTabAggregation {
  readonly keep: readonly ExternalSession[]
  readonly groups: readonly AggregatedCursorTabGroup[]
  readonly summarySession: ExternalSession | null
}

export function isCursorTabSession(session: Pick<ExternalSession, 'source' | 'surface'>): boolean {
  return session.source === 'cursor' && session.surface === 'cursor-tab'
}

export function aggregateCursorTabSessions(input: {
  readonly sessions: readonly ExternalSession[]
  readonly claims?: readonly ResourceClaim[]
  readonly now?: number
  readonly windowMs?: number
}): CursorTabAggregation {
  const windowMs = input.windowMs ?? CURSOR_TAB_AGGREGATION_WINDOW_MS
  const now = input.now ?? Date.now()
  const keep: ExternalSession[] = []
  const tabs: ExternalSession[] = []
  for (const session of input.sessions) {
    if (isCursorTabSession(session)) {
      tabs.push(session)
    } else {
      keep.push(session)
    }
  }
  if (tabs.length === 0) {
    return { keep, groups: [], summarySession: null }
  }

  const recent = tabs.filter((session) => {
    const last = Date.parse(session.lastObservedAt)
    return !Number.isNaN(last) && now - last <= windowMs
  })
  const sourceTabs = recent.length > 0 ? recent : tabs
  const tabIds = new Set(sourceTabs.map((session) => session.id))
  const groups = new Map<string, AggregatedCursorTabGroup>()
  for (const claim of input.claims ?? []) {
    if (!claim.externalSessionId || !tabIds.has(claim.externalSessionId)) {
      continue
    }
    const key = `${claim.repositoryId ?? ''}\0${claim.resourceKey}`
    const existing = groups.get(key)
    if (existing) {
      groups.set(key, {
        ...existing,
        count: existing.count + 1,
        lastObservedAt:
          claim.lastObservedAt > existing.lastObservedAt
            ? claim.lastObservedAt
            : existing.lastObservedAt,
        sessionIds: existing.sessionIds.includes(claim.externalSessionId)
          ? existing.sessionIds
          : [...existing.sessionIds, claim.externalSessionId],
      })
    } else {
      groups.set(key, {
        repositoryId: claim.repositoryId,
        path: claim.resourceKey,
        count: 1,
        lastObservedAt: claim.lastObservedAt,
        sessionIds: [claim.externalSessionId],
      })
    }
  }

  const latest = sourceTabs.reduce((current, session) =>
    session.lastObservedAt > current.lastObservedAt ? session : current,
  )
  const paths = [...groups.values()].sort((left, right) =>
    right.lastObservedAt.localeCompare(left.lastObservedAt),
  )
  const title = tabSummaryTitle(paths)
  return {
    keep,
    groups: paths,
    summarySession: {
      ...latest,
      surface: 'cursor-tab',
      title,
    },
  }
}

export function tabSummaryTitle(
  groups: readonly Pick<AggregatedCursorTabGroup, 'path' | 'count'>[],
): string {
  if (groups.length === 0) {
    return '小さな編集をまとめています'
  }
  const first = groups[0]?.path ?? 'ファイル'
  if (groups.length === 1) {
    return first
  }
  return `${first} ほか ${groups.length - 1} 件`
}
