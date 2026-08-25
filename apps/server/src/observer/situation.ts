import {
  aggregateCursorTabSessions,
  displayNameForSource,
  isCursorTabSession,
  OBSERVER_UI_MAX_FILES,
  OBSERVER_UI_MAX_SESSIONS,
  clipList,
  type ExternalSession,
  type NormalizedObserverEvent,
  type ObservedWork,
  type ResourceClaim,
} from '@sikumi-local/observer-core'

const TERMINAL_STATUSES = new Set(['ended', 'failed', 'completed'])
const GENERIC_TITLES = new Set([
  '作業',
  '作業中',
  '無題',
  '変更元不明の作業',
])

export interface SituationGitInput {
  readonly repositoryId: string
  readonly available: boolean
  readonly changedFileCount: number
  readonly changedPaths: readonly string[]
  readonly scannedAt: string | null
}

export interface SituationInput {
  readonly sessions: readonly ExternalSession[]
  readonly events?: readonly NormalizedObserverEvent[]
  readonly claims?: readonly ResourceClaim[]
  readonly git?: readonly SituationGitInput[]
  readonly now?: number
}

export function buildObservedWorks(input: SituationInput): ObservedWork[] {
  const claims = input.claims ?? []
  const events = input.events ?? []
  const now = input.now ?? Date.now()
  const aggregated = aggregateCursorTabSessions({
    sessions: input.sessions,
    claims,
    now,
  })
  const visible = aggregated.summarySession
    ? [...aggregated.keep, aggregated.summarySession]
    : aggregated.keep
  const tabIds = new Set(
    input.sessions.filter(isCursorTabSession).map((session) => session.id),
  )

  const works = visible.flatMap((session) => {
    if (session.source === 'git') {
      return []
    }
    if (TERMINAL_STATUSES.has(session.status)) {
      return []
    }
    const latest = latestEventFor(session, events)
    const activity =
      latest && latest.occurredAt >= session.lastObservedAt
        ? latest.activity
        : session.activity
    const status = nextWorkStatus(session, latest)
    const sessionIds =
      isCursorTabSession(session) && tabIds.size > 0
        ? [...tabIds]
        : [session.id]
    const claimedPaths = unique(
      claims
        .filter((claim) =>
          claim.externalSessionId
            ? sessionIds.includes(claim.externalSessionId)
            : false,
        )
        .map((claim) => claim.resourceKey),
    )
    const bounded = clipList(claimedPaths, OBSERVER_UI_MAX_FILES)
    return [
      {
        id: session.id,
        sessionId: session.id,
        source: session.source,
        surface: session.surface,
        displayName: workDisplayName(session),
        repositoryId: session.repositoryId,
        workspaceId: session.workspaceId,
        title: workTitle(session, latest),
        activity,
        status,
        attributionConfidence: session.attributionConfidence,
        claimedPaths: bounded.items,
        lastObservedAt:
          latest && latest.occurredAt > session.lastObservedAt
            ? latest.occurredAt
            : session.lastObservedAt,
        startedAt: session.startedAt,
      } satisfies ObservedWork,
    ]
  })

  return clipList(
    works.sort((left, right) =>
      right.lastObservedAt.localeCompare(left.lastObservedAt),
    ),
    OBSERVER_UI_MAX_SESSIONS,
  ).items.slice()
}

export function workDisplayName(session: ExternalSession): string {
  if (session.source === 'claude-desktop') {
    return 'Claudeアプリ'
  }
  if (session.source === 'grok-build') {
    return 'Grok Build'
  }
  if (session.source === 'claude-code') {
    return 'Claude Code'
  }
  if (session.source === 'cursor') {
    if (session.surface === 'cursor-tab') {
      return 'Cursor Tab'
    }
    if (session.surface === 'cursor-cli') {
      return 'Cursor CLI'
    }
    if (session.surface === 'cursor-agent') {
      return 'Cursor Agent'
    }
    return 'Cursor'
  }
  if (session.source === 'codex') {
    return 'Codex'
  }
  return displayNameForSource(session.source)
}

function workTitle(
  session: ExternalSession,
  event: NormalizedObserverEvent | undefined,
): string | null {
  const sessionTitle = usableTitle(session.title)
  if (sessionTitle) {
    return sessionTitle
  }
  return usableTitle(event?.summary ?? null)
}

function usableTitle(title: string | null): string | null {
  const trimmed = title?.trim() ?? ''
  if (!trimmed || GENERIC_TITLES.has(trimmed)) {
    return null
  }
  return trimmed
}

function nextWorkStatus(
  session: ExternalSession,
  event: NormalizedObserverEvent | undefined,
): ExternalSession['status'] {
  if (
    session.status === 'waiting-for-user' ||
    session.activity === 'waiting-for-user'
  ) {
    return 'waiting-for-user'
  }
  if (!event || event.occurredAt < session.lastObservedAt) {
    return session.status
  }
  if (
    event.normalizedType === 'permission.requested' ||
    event.normalizedType === 'user.input_required' ||
    event.activity === 'waiting-for-user'
  ) {
    return 'waiting-for-user'
  }
  return session.status
}

function latestEventFor(
  session: ExternalSession,
  events: readonly NormalizedObserverEvent[],
): NormalizedObserverEvent | undefined {
  return events
    .filter((event) => eventBelongsTo(session, event))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]
}

function eventBelongsTo(
  session: ExternalSession,
  event: NormalizedObserverEvent,
): boolean {
  if (event.source !== session.source) {
    return false
  }
  if (
    session.repositoryId &&
    event.repositoryId &&
    event.repositoryId !== session.repositoryId
  ) {
    return false
  }
  if (session.externalSessionId && event.externalSessionId) {
    return event.externalSessionId === session.externalSessionId
  }
  return true
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}
