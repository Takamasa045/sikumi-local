import {
  OBSERVER_MAX_CONFLICT_CLAIMS_PER_SIDE,
  OBSERVER_MAX_CONFLICT_PAIR_COMPARISONS,
  OBSERVER_MAX_CONFLICT_REASONS,
  OBSERVER_TRUNCATED_WARNING,
} from '../limits.js'
import {
  scoreToConflictLevel,
  type AttributionConfidence,
  type ResourceClaim,
} from '../types.js'
import { explainHits } from './explain.js'
import {
  actorKey,
  conflictFingerprint,
  conflictIdFromKey,
  conflictIdentityKey,
  orderedSides,
  sameConflictActor,
} from './identity.js'
import { maxScore, scoreSides } from './scoring.js'
import {
  INACTIVE_SESSION_STATUSES,
  type AnalyzedConflict,
  type AnalyzeRepositoryConflictsInput,
  type ConflictAnalysisReport,
  type ConflictClaimInput,
  type ConflictSide,
  type ConflictWorktreeInput,
} from './types.js'

export function analyzeRepositoryConflicts(
  input: AnalyzeRepositoryConflictsInput,
): AnalyzedConflict[] {
  return analyzeRepositoryConflictsReport(input).findings
}

export function analyzeRepositoryConflictsReport(
  input: AnalyzeRepositoryConflictsInput,
): ConflictAnalysisReport {
  const sides = buildConflictSides(input).map(boundConflictSide)
  const claimsTruncated = sides.some(
    (side) => side.claims.length >= OBSERVER_MAX_CONFLICT_CLAIMS_PER_SIDE,
  )
  const findings: AnalyzedConflict[] = []
  const sorted = [...sides].sort((left, right) =>
    actorKey(left).localeCompare(actorKey(right)),
  )
  let comparedPairs = 0
  let pairTruncated = false
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    if (pairTruncated) {
      break
    }
    for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
      if (comparedPairs >= OBSERVER_MAX_CONFLICT_PAIR_COMPARISONS) {
        pairTruncated = true
        break
      }
      const left = sorted[leftIndex]
      const right = sorted[rightIndex]
      if (!left || !right || sameConflictActor(left, right)) {
        continue
      }
      comparedPairs += 1
      const analyzed = analyzeConflictPair({
        repositoryId: input.repositoryId,
        left,
        right,
        commonBase: input.commonBaseForPair?.(left, right) ?? pairBase(left, right),
      })
      if (analyzed) {
        findings.push(analyzed)
      }
    }
  }
  const truncated = claimsTruncated || pairTruncated
  const sortedFindings = findings.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return left.identityKey.localeCompare(right.identityKey)
  })
  return {
    findings: truncated
      ? sortedFindings.map((finding) =>
          finding.reasons.includes(OBSERVER_TRUNCATED_WARNING)
            ? finding
            : {
                ...finding,
                reasons: [...finding.reasons, OBSERVER_TRUNCATED_WARNING].slice(
                  0,
                  OBSERVER_MAX_CONFLICT_REASONS,
                ),
              },
        )
      : sortedFindings,
    truncated,
    comparedPairs,
    warning: truncated ? OBSERVER_TRUNCATED_WARNING : null,
  }
}

function boundConflictSide(side: ConflictSide): ConflictSide {
  if (side.claims.length <= OBSERVER_MAX_CONFLICT_CLAIMS_PER_SIDE) {
    return side
  }
  return {
    ...side,
    claims: side.claims.slice(0, OBSERVER_MAX_CONFLICT_CLAIMS_PER_SIDE),
  }
}

export function analyzeConflictPair(input: {
  readonly repositoryId: string
  readonly left: ConflictSide
  readonly right: ConflictSide
  readonly commonBase?: string | null
}): AnalyzedConflict | null {
  const [left, right] = orderedSides(input.left, input.right)
  if (sameConflictActor(left, right)) {
    return null
  }
  const hits = scoreSides(left.claims, right.claims)
  const score = maxScore(hits)
  if (score < 30) {
    return null
  }
  const explained = explainHits(left, right, hits, score)
  const identityKey = conflictIdentityKey(input.repositoryId, left, right)
  const changedPaths = unique([
    ...hits.flatMap((hit) => [hit.leftPath, hit.rightPath]),
    ...left.claims.map((claim) => claim.resourceKey),
    ...right.claims.map((claim) => claim.resourceKey),
  ]).filter((path): path is string => Boolean(path))
  return {
    identityKey,
    id: conflictIdFromKey(identityKey),
    repositoryId: input.repositoryId,
    left,
    right,
    level: scoreToConflictLevel(score),
    score,
    confidence: pairConfidence(left, right),
    headline: explained.headline,
    summary: explained.summary,
    recommendation: explained.recommendation,
    reasons: explained.reasons,
    evidence: explained.evidence,
    fingerprint: conflictFingerprint(
      hits.map(
        (hit) => `${hit.kind}:${hit.leftPath ?? ''}:${hit.rightPath ?? ''}`,
      ),
    ),
    resources: explained.resources,
    technical: {
      leftBranch: left.branch,
      rightBranch: right.branch,
      leftWorktreePath: left.worktreePath,
      rightWorktreePath: right.worktreePath,
      leftHead: left.headCommit,
      rightHead: right.headCommit,
      commonBase: input.commonBase ?? pairBase(left, right),
      changedPaths,
    },
  }
}

export function buildConflictSides(
  input: Pick<
    AnalyzeRepositoryConflictsInput,
    'worktrees' | 'sessions' | 'claims'
  >,
): ConflictSide[] {
  const sides: ConflictSide[] = []
  const usedSessionIds = new Set<string>()
  const activeSessions = input.sessions.filter(
    (session) => !INACTIVE_SESSION_STATUSES.has(session.status),
  )
  const claimsBySession = groupClaims(input.claims)

  for (const worktree of input.worktrees) {
    const onWorktree = activeSessions.filter((session) =>
      samePath(session.worktreePath, worktree.path),
    )
    const aiSessions = onWorktree.filter((session) => session.source !== 'git')
    const gitSession = onWorktree.find((session) => session.source === 'git')
    const gitClaims = filesToClaims(worktree)

    if (aiSessions.length === 0) {
      if (worktree.files.length > 0) {
        sides.push(
          sideFromUnknownWorktree(worktree, gitSession?.id ?? null, gitClaims),
        )
      }
      continue
    }

    if (aiSessions.length === 1 && aiSessions[0]) {
      const session = aiSessions[0]
      usedSessionIds.add(session.id)
      sides.push({
        ...sideFromSession(session, worktree),
        claims: mergeClaims(claimsBySession.get(session.id) ?? [], gitClaims),
      })
      continue
    }

    for (const session of aiSessions) {
      usedSessionIds.add(session.id)
      sides.push({
        ...sideFromSession(session, worktree),
        claims: claimsBySession.get(session.id) ?? [],
      })
    }
  }

  for (const session of activeSessions) {
    if (session.source === 'git' || usedSessionIds.has(session.id)) {
      continue
    }
    const claims = claimsBySession.get(session.id) ?? []
    if (claims.length === 0) {
      continue
    }
    sides.push({
      ...sideFromSession(session, null),
      claims,
    })
  }

  return sides
}

function sideFromSession(
  session: AnalyzeRepositoryConflictsInput['sessions'][number],
  worktree: ConflictWorktreeInput | null,
): Omit<ConflictSide, 'claims'> {
  return {
    sessionId: session.id,
    source: session.source,
    attributionConfidence: session.attributionConfidence,
    status: session.status,
    worktreePath: worktree?.path ?? session.worktreePath,
    branch: worktree?.branch ?? session.branch,
    headCommit: worktree?.headCommit ?? session.headCommit,
    baseCommit: worktree?.baseCommit ?? session.baseCommit,
  }
}

function sideFromUnknownWorktree(
  worktree: ConflictWorktreeInput,
  sessionId: string | null,
  claims: readonly ConflictClaimInput[],
): ConflictSide {
  return {
    sessionId,
    source: 'git',
    attributionConfidence: 'inferred',
    status: 'detected',
    worktreePath: worktree.path,
    branch: worktree.branch,
    headCommit: worktree.headCommit,
    baseCommit: worktree.baseCommit,
    claims,
  }
}

function filesToClaims(
  worktree: ConflictWorktreeInput,
): ConflictClaimInput[] {
  return worktree.files.map((file) => ({
    resourceType: 'file',
    resourceKey: file.path,
    action:
      file.action ??
      (file.changeType === 'deleted'
        ? 'delete'
        : file.changeType === 'added' || file.changeType === 'untracked'
          ? 'create'
          : 'write'),
    claimKind: 'observed',
    ...(file.changeType ? { changeType: file.changeType } : {}),
    previousPath: file.previousPath ?? null,
  }))
}

function mergeClaims(
  sessionClaims: readonly ResourceClaim[],
  gitClaims: readonly ConflictClaimInput[],
): ConflictClaimInput[] {
  const mapped = sessionClaims.map(toClaimInput)
  const seen = new Set(mapped.flatMap((claim) => [claim.resourceKey]))
  const extra = gitClaims.filter((claim) => !seen.has(claim.resourceKey))
  return [...mapped, ...extra]
}

function toClaimInput(claim: ResourceClaim): ConflictClaimInput {
  return {
    resourceType: claim.resourceType,
    resourceKey: claim.resourceKey,
    action: claim.action,
    claimKind: claim.claimKind,
  }
}

function groupClaims(
  claims: readonly ResourceClaim[],
): Map<string, ResourceClaim[]> {
  const grouped = new Map<string, ResourceClaim[]>()
  for (const claim of claims) {
    if (!claim.externalSessionId) {
      continue
    }
    const list = grouped.get(claim.externalSessionId) ?? []
    list.push(claim)
    grouped.set(claim.externalSessionId, list)
  }
  return grouped
}

function pairConfidence(
  left: ConflictSide,
  right: ConflictSide,
): AttributionConfidence {
  const order: AttributionConfidence[] = [
    'unknown',
    'inferred',
    'correlated',
    'reported',
    'verified',
  ]
  return order[
    Math.min(
      order.indexOf(left.attributionConfidence),
      order.indexOf(right.attributionConfidence),
    )
  ] ?? 'inferred'
}

function pairBase(left: ConflictSide, right: ConflictSide): string | null {
  if (left.headCommit && right.headCommit && left.headCommit === right.headCommit) {
    return left.headCommit
  }
  if (left.baseCommit && right.baseCommit && left.baseCommit === right.baseCommit) {
    return left.baseCommit
  }
  return null
}

function samePath(left: string | null | undefined, right: string): boolean {
  if (!left) {
    return false
  }
  return left.replaceAll('\\', '/') === right.replaceAll('\\', '/')
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
