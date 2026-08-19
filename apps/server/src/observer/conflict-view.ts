import {
  isSafeRelativePath,
  safeActorLabel,
  toRepoRelativePath,
  type AttributionConfidence,
  type ConflictFinding,
  type ExternalSession,
  type ObserverSourceId,
} from '@sikumi-local/observer-core'
import {
  matchLongestObservedRoot,
  resolveMergeBase,
  sanitizeRepoPath,
} from '@sikumi-local/observer-git'
import type { CombinedStore } from '../storage/store.js'
import type {
  RegisteredRepository,
  StoredRepositorySnapshot,
} from '../storage/observer-store.js'
import { presentConflict, type ObserverViewMode } from './views.js'

export interface ConflictTechnicalView {
  readonly leftBranch: string | null
  readonly rightBranch: string | null
  readonly leftWorktreePath: string | null
  readonly rightWorktreePath: string | null
  readonly leftHead: string | null
  readonly rightHead: string | null
  readonly commonBase: string
  readonly changedPaths: readonly string[]
}

export interface ConflictActorView {
  readonly leftActorLabel: string
  readonly rightActorLabel: string
  readonly leftAttributionConfidence: AttributionConfidence
  readonly rightAttributionConfidence: AttributionConfidence
}

export interface ConflictApiView extends ConflictFinding, ConflictActorView {
  readonly repositoryDisplayName: string
  readonly technical?: ConflictTechnicalView
}

export function presentConflictView(
  finding: ConflictFinding,
  store: CombinedStore,
  mode: ObserverViewMode,
): ConflictApiView {
  const presented = presentConflict(finding, mode)
  const repository = store.getRegisteredRepository(finding.repositoryId)
  const leftSession = finding.leftSessionId
    ? store.getExternalSession(finding.leftSessionId)
    : undefined
  const rightSession = finding.rightSessionId
    ? store.getExternalSession(finding.rightSessionId)
    : undefined
  const actors = presentConflictActors(finding, leftSession, rightSession)
  return {
    ...presented,
    ...actors,
    repositoryDisplayName: repository?.displayName ?? finding.repositoryId,
    ...(mode === 'detail'
      ? {
          technical: presentConflictTechnical({
            finding,
            repository,
            snapshots: store.latestSnapshotsByRepository(finding.repositoryId),
            leftSession,
            rightSession,
          }),
        }
      : {}),
  }
}

export function presentConflictActors(
  finding: ConflictFinding,
  leftSession?: ExternalSession,
  rightSession?: ExternalSession,
): ConflictActorView {
  const leftAttributionConfidence = sideConfidence(
    leftSession,
    finding.leftSource,
    finding.leftAttributionConfidence,
  )
  const rightAttributionConfidence = sideConfidence(
    rightSession,
    finding.rightSource,
    finding.rightAttributionConfidence,
  )
  return {
    leftAttributionConfidence,
    rightAttributionConfidence,
    leftActorLabel: safeActorLabel(
      finding.leftSource,
      leftAttributionConfidence,
    ),
    rightActorLabel: safeActorLabel(
      finding.rightSource,
      rightAttributionConfidence,
    ),
  }
}

export function presentConflictTechnical(input: {
  readonly finding: ConflictFinding
  readonly repository: RegisteredRepository | undefined
  readonly snapshots: readonly StoredRepositorySnapshot[]
  readonly leftSession?: ExternalSession | undefined
  readonly rightSession?: ExternalSession | undefined
}): ConflictTechnicalView {
  const allowedRoots = registeredRoots(input.repository, input.snapshots)
  const leftSnapshot = snapshotForSide(
    input.snapshots,
    input.finding.leftWorktreePath,
    input.leftSession,
  )
  const rightSnapshot = snapshotForSide(
    input.snapshots,
    input.finding.rightWorktreePath,
    input.rightSession,
  )
  const leftWorktreePath = revealWorktreePath(
    leftSnapshot?.worktreePath ??
      input.finding.leftWorktreePath ??
      input.leftSession?.worktreePath,
    allowedRoots,
  )
  const rightWorktreePath = revealWorktreePath(
    rightSnapshot?.worktreePath ??
      input.finding.rightWorktreePath ??
      input.rightSession?.worktreePath,
    allowedRoots,
  )
  const leftHead =
    leftSnapshot?.headCommit ?? input.leftSession?.headCommit ?? null
  const rightHead =
    rightSnapshot?.headCommit ?? input.rightSession?.headCommit ?? null
  const cwd = mergeBaseCwd(
    input.repository,
    leftWorktreePath,
    rightWorktreePath,
    allowedRoots,
  )
  const resolvedBase = cwd ? resolveMergeBase(cwd, leftHead, rightHead) : null
  return {
    leftBranch: leftSnapshot?.branch ?? input.leftSession?.branch ?? null,
    rightBranch: rightSnapshot?.branch ?? input.rightSession?.branch ?? null,
    leftWorktreePath,
    rightWorktreePath,
    leftHead,
    rightHead,
    commonBase: resolvedBase ?? 'unknown',
    changedPaths: collectChangedPaths({
      finding: input.finding,
      repository: input.repository,
      leftSnapshot,
      rightSnapshot,
    }),
  }
}

function sideConfidence(
  session: ExternalSession | undefined,
  source: ObserverSourceId | null,
  persisted: AttributionConfidence | undefined,
): AttributionConfidence {
  if (session?.attributionConfidence) {
    return session.attributionConfidence
  }
  if (persisted) {
    return persisted
  }
  return source === 'git' ? 'inferred' : 'unknown'
}

function snapshotForSide(
  snapshots: readonly StoredRepositorySnapshot[],
  worktreePath: string | null,
  session?: ExternalSession,
): StoredRepositorySnapshot | undefined {
  const candidates = [worktreePath, session?.worktreePath].filter(
    (value): value is string => Boolean(value),
  )
  for (const candidate of candidates) {
    const exact = snapshots.find((item) =>
      samePath(item.worktreePath, candidate),
    )
    if (exact) {
      return exact
    }
  }
  return undefined
}

function registeredRoots(
  repository: RegisteredRepository | undefined,
  snapshots: readonly StoredRepositorySnapshot[],
): string[] {
  return [
    ...(repository?.absolutePath ? [repository.absolutePath] : []),
    ...snapshots.map((item) => item.worktreePath),
  ]
}

function revealWorktreePath(
  path: string | null | undefined,
  allowedRoots: readonly string[],
): string | null {
  if (!path) {
    return null
  }
  return matchLongestObservedRoot(path, allowedRoots) ? path : null
}

function mergeBaseCwd(
  repository: RegisteredRepository | undefined,
  leftWorktreePath: string | null,
  rightWorktreePath: string | null,
  allowedRoots: readonly string[],
): string | null {
  for (const candidate of [
    repository?.absolutePath,
    leftWorktreePath,
    rightWorktreePath,
  ]) {
    if (candidate && matchLongestObservedRoot(candidate, allowedRoots)) {
      return candidate
    }
  }
  return null
}

function collectChangedPaths(input: {
  readonly finding: ConflictFinding
  readonly repository: RegisteredRepository | undefined
  readonly leftSnapshot?: StoredRepositorySnapshot | undefined
  readonly rightSnapshot?: StoredRepositorySnapshot | undefined
}): string[] {
  const raw = [
    ...input.finding.evidence.flatMap((item) => [
      item.leftPath,
      item.rightPath,
    ]),
    ...snapshotPaths(input.leftSnapshot),
    ...snapshotPaths(input.rightSnapshot),
  ]
  return unique(
    raw.flatMap((path) => {
      const sanitized = sanitizeChangedPath(path, input.repository)
      return sanitized ? [sanitized] : []
    }),
  )
}

function snapshotPaths(
  snapshot: StoredRepositorySnapshot | undefined,
): string[] {
  if (!snapshot) {
    return []
  }
  return snapshot.changedFiles.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('path' in item)) {
      return []
    }
    return typeof item.path === 'string' ? [item.path] : []
  })
}

function sanitizeChangedPath(
  path: string | null | undefined,
  repository: RegisteredRepository | undefined,
): string | null {
  if (!path) {
    return null
  }
  if (isSafeRelativePath(path)) {
    return toRepoRelativePath(path)
  }
  if (
    repository?.absolutePath &&
    matchLongestObservedRoot(path, [repository.absolutePath])
  ) {
    return sanitizeRepoPath(path, repository.absolutePath)
  }
  return null
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll('\\', '/') === right.replaceAll('\\', '/')
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
