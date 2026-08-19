import {
  aggregateCursorTabSessions,
  changeTypeLabel,
  clipList,
  OBSERVER_TRUNCATED_WARNING,
  OBSERVER_UI_MAX_CONFLICTS,
  OBSERVER_UI_MAX_FILES,
  OBSERVER_UI_MAX_REPOSITORIES,
  OBSERVER_UI_MAX_SESSIONS,
  relativeTimeLabel,
  summarizeAreas,
  type ConflictFinding,
  type ExternalSession,
  type ResourceClaim,
  type SessionLabel,
} from '@sikumi-local/observer-core'
import type { GitRepositorySnapshot } from '@sikumi-local/observer-git'
import type { RegisteredRepository } from '../storage/observer-store.js'

export interface RepositoryActivityView {
  readonly repositoryId: string
  readonly workspaceId: string
  readonly displayName: string
  readonly available: boolean
  readonly gitAvailable: boolean
  readonly summary: string
  readonly changedFileCount: number
  readonly lastChangedAt: string | null
  readonly lastChangedLabel: string | null
  readonly sessions: readonly SessionView[]
  readonly worktrees: readonly WorktreeView[]
  readonly conflicts: readonly ConflictFinding[]
  readonly areas: readonly string[]
  readonly truncated: boolean
  readonly warnings: readonly string[]
}

export interface SessionView {
  readonly id: string
  readonly source: ExternalSession['source']
  readonly surface: ExternalSession['surface']
  readonly displayName: string
  readonly status: ExternalSession['status']
  readonly activity: ExternalSession['activity']
  readonly attributionConfidence: ExternalSession['attributionConfidence']
  readonly title: string
  readonly lastObservedAt: string
  readonly lastObservedLabel: string | null
}

export interface WorktreeView {
  readonly path: string
  readonly isPrimary: boolean
  readonly branch: string | null
  readonly changedFileCount: number
  readonly returnedFileCount: number
  readonly filesTruncated: boolean
  readonly files: ReadonlyArray<{
    readonly path: string
    readonly changeLabel: string
    readonly areaLabel: string
    readonly addedLines: number | null
    readonly deletedLines: number | null
  }>
}

export interface TodayOverview {
  readonly generatedAt: string
  readonly repositoryCount: number
  readonly activeRepositoryCount: number
  readonly waitingCount: number
  readonly conflictCount: number
  readonly repositories: readonly RepositoryActivityView[]
  readonly truncated: boolean
}

export type ObserverViewMode = 'simple' | 'detail'

export function presentRepositoryActivity(
  activity: RepositoryActivityView,
  mode: ObserverViewMode = 'simple',
): RepositoryActivityView {
  if (mode === 'detail') {
    return {
      ...activity,
      conflicts: activity.conflicts.map((item) =>
        presentConflict(item, 'detail'),
      ),
    }
  }
  return {
    ...activity,
    worktrees: activity.worktrees.map((worktree, index) => ({
      ...worktree,
      path: worktree.isPrimary ? 'primary' : `other-${index}`,
      branch: null,
    })),
    conflicts: activity.conflicts.map((item) =>
      presentConflict(item, 'simple'),
    ),
  }
}

export function presentConflict(
  finding: ConflictFinding,
  mode: ObserverViewMode = 'simple',
): ConflictFinding {
  if (mode === 'detail') {
    return finding
  }
  return {
    ...finding,
    leftWorktreePath: null,
    rightWorktreePath: null,
    evidence: finding.evidence.map((item) => ({
      kind: item.kind,
      label: item.label,
    })),
  }
}

export function buildRepositoryActivity(input: {
  readonly repository: RegisteredRepository
  readonly snapshot: GitRepositorySnapshot
  readonly sessions: readonly ExternalSession[]
  readonly labels: Readonly<Record<string, SessionLabel | undefined>>
  readonly conflicts: readonly ConflictFinding[]
  readonly claims: readonly ResourceClaim[]
}): RepositoryActivityView {
  const changedFileCount = input.snapshot.worktrees.reduce(
    (sum, worktree) => sum + worktree.changedFileCount,
    0,
  )
  const areas = summarizeAreas(
    input.snapshot.changedFiles.map((file) => file.path),
  )
  const waiting = input.sessions.filter(
    (session) => session.status === 'waiting-for-user',
  )
  const summary = buildSummary({
    available: input.snapshot.available,
    changedFileCount,
    areas,
    sessions: input.sessions,
    waiting: waiting.length,
    conflicts: input.conflicts.filter((item) => item.status === 'open'),
  })
  const sessions = clipList(
    presentSessions(input.sessions, input.labels, input.claims),
    OBSERVER_UI_MAX_SESSIONS,
  )
  const conflicts = clipList(
    input.conflicts.filter((item) => item.status !== 'resolved'),
    OBSERVER_UI_MAX_CONFLICTS,
  )
  const worktrees = input.snapshot.worktrees.map((worktree) => {
    const files = clipList(worktree.changedFiles, OBSERVER_UI_MAX_FILES)
    return {
      path: worktree.path,
      isPrimary: worktree.isPrimary,
      branch: worktree.branch,
      changedFileCount: worktree.changedFileCount,
      returnedFileCount: files.items.length,
      filesTruncated: files.truncated || worktree.truncated,
      files: files.items.map((file) => ({
        path: file.path,
        changeLabel: changeTypeLabel(file.changeType),
        areaLabel: file.label,
        addedLines: file.addedLines,
        deletedLines: file.deletedLines,
      })),
    }
  })
  const truncated =
    sessions.truncated ||
    conflicts.truncated ||
    worktrees.some((worktree) => worktree.filesTruncated) ||
    input.snapshot.truncated
  const warnings = truncated ? [OBSERVER_TRUNCATED_WARNING] : []

  return {
    repositoryId: input.repository.id,
    workspaceId: input.repository.workspaceId,
    displayName: input.repository.displayName,
    available: input.snapshot.available,
    gitAvailable: input.snapshot.available,
    summary,
    changedFileCount,
    lastChangedAt: input.snapshot.scannedAt,
    lastChangedLabel: relativeTimeLabel(input.snapshot.scannedAt),
    sessions: sessions.items,
    worktrees,
    conflicts: conflicts.items,
    areas,
    truncated,
    warnings,
  }
}

export function buildTodayOverview(
  repositories: readonly RepositoryActivityView[],
  generatedAt = new Date().toISOString(),
): TodayOverview {
  const bounded = clipList(repositories, OBSERVER_UI_MAX_REPOSITORIES)
  return {
    generatedAt,
    repositoryCount: bounded.total,
    activeRepositoryCount: repositories.filter(
      (item) => item.changedFileCount > 0 || item.sessions.length > 0,
    ).length,
    waitingCount: repositories.reduce(
      (sum, item) =>
        sum +
        item.sessions.filter((session) => session.status === 'waiting-for-user')
          .length,
      0,
    ),
    conflictCount: repositories.reduce(
      (sum, item) =>
        sum +
        item.conflicts.filter((conflict) => conflict.status === 'open').length,
      0,
    ),
    repositories: bounded.items,
    truncated: bounded.truncated || repositories.some((item) => item.truncated),
  }
}

function presentSessions(
  sessions: readonly ExternalSession[],
  labels: Readonly<Record<string, SessionLabel | undefined>>,
  claims: readonly ResourceClaim[],
): SessionView[] {
  const aggregated = aggregateCursorTabSessions({ sessions, claims })
  const visible = aggregated.summarySession
    ? [...aggregated.keep, aggregated.summarySession]
    : aggregated.keep
  return visible.map((session) => toSessionView(session, labels[session.id]))
}

function toSessionView(
  session: ExternalSession,
  label?: SessionLabel,
): SessionView {
  return {
    id: session.id,
    source: session.source,
    surface: session.surface,
    displayName: sessionDisplayName(session),
    status: session.status,
    activity: session.activity,
    attributionConfidence: session.attributionConfidence,
    title: presentSessionTitle(session, label),
    lastObservedAt: session.lastObservedAt,
    lastObservedLabel: relativeTimeLabel(session.lastObservedAt),
  }
}

const GENERIC_SESSION_TITLES = new Set([
  '作業',
  '作業中',
  '無題',
  '変更元不明の作業',
])

const GENERIC_SESSION_TITLE_PATTERNS = [
  /の作業が始まりました$/,
  /の作業が終わりました$/,
  /の様子が届きました$/,
  /が確認を待っています$/,
  /がファイルを扱っています$/,
  /が道具を使っています$/,
  /のサブエージェントが始まりました$/,
]

function presentSessionTitle(
  session: ExternalSession,
  label?: SessionLabel,
): string {
  const candidates = [label?.title, session.title]
  for (const candidate of candidates) {
    const title = candidate?.trim() ?? ''
    if (!title || isGenericSessionTitle(title)) {
      continue
    }
    return title
  }
  return ''
}

function isGenericSessionTitle(title: string): boolean {
  if (GENERIC_SESSION_TITLES.has(title)) {
    return true
  }
  return GENERIC_SESSION_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

function describeKnownChangeSummary(
  changedFileCount: number,
  areas: readonly string[],
): string {
  const named = areas.filter((area) => area && area !== '作業中のファイル')
  const areaText = named.slice(0, 3).join('、')
  if (changedFileCount <= 0 && named.length === 0) {
    return '現在観測中の作業はありません'
  }
  if (changedFileCount <= 0) {
    return areaText
  }
  const files =
    changedFileCount === 1
      ? '作業中のファイルが1つある'
      : `作業中のファイルが${changedFileCount}件ある`
  return areaText ? `${files}。${areaText}` : files
}

function sessionDisplayName(session: ExternalSession): string {
  if (session.source === 'git') {
    return '変更元不明'
  }
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
  return 'Codex'
}

function buildSummary(input: {
  readonly available: boolean
  readonly changedFileCount: number
  readonly areas: readonly string[]
  readonly sessions: readonly ExternalSession[]
  readonly waiting: number
  readonly conflicts: readonly ConflictFinding[]
}): string {
  if (!input.available) {
    return 'この場所は今は観測できません'
  }
  if (input.conflicts.length > 0) {
    return input.conflicts[0]?.summary ?? '作業が近づいています'
  }
  if (input.waiting > 0) {
    return '確認が必要な作業があります'
  }
  if (input.changedFileCount === 0 && input.sessions.length === 0) {
    return '現在観測中の作業はありません'
  }
  if (input.sessions.every((session) => session.source === 'git')) {
    return describeKnownChangeSummary(input.changedFileCount, input.areas)
  }
  const named = input.sessions
    .filter((session) => session.source !== 'git')
    .map((session) => session.source)
  return named.length > 0
    ? '作業が続いています'
    : 'まだ記録していない変更があります'
}
