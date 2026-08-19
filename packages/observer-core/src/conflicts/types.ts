import type {
  AttributionConfidence,
  ConflictEvidenceItem,
  ConflictFinding,
  ConflictLevel,
  ExternalSession,
  ExternalSessionStatus,
  ObserverChangeType,
  ObserverSourceId,
  ResourceAction,
  ResourceClaim,
  ResourceClaimKind,
  ResourceType,
} from '../types.js'

export interface ConflictClaimInput {
  readonly resourceType: ResourceType
  readonly resourceKey: string
  readonly action: ResourceAction
  readonly claimKind: ResourceClaimKind
  readonly changeType?: ObserverChangeType
  readonly previousPath?: string | null
  readonly importedPaths?: readonly string[]
}

export interface ConflictSide {
  readonly sessionId: string | null
  readonly source: ObserverSourceId
  readonly attributionConfidence: AttributionConfidence
  readonly status?: ExternalSessionStatus
  readonly worktreePath: string | null
  readonly branch: string | null
  readonly headCommit: string | null
  readonly baseCommit: string | null
  readonly claims: readonly ConflictClaimInput[]
}

export interface ConflictWorktreeInput {
  readonly path: string
  readonly branch: string | null
  readonly headCommit: string | null
  readonly baseCommit: string | null
  readonly files: ReadonlyArray<{
    readonly path: string
    readonly previousPath?: string | null
    readonly changeType?: ObserverChangeType
    readonly action?: ResourceAction
  }>
}

export interface AnalyzeRepositoryConflictsInput {
  readonly repositoryId: string
  readonly worktrees: readonly ConflictWorktreeInput[]
  readonly sessions: readonly ExternalSession[]
  readonly claims: readonly ResourceClaim[]
  readonly now: string
  readonly commonBaseForPair?: (
    left: ConflictSide,
    right: ConflictSide,
  ) => string | null
}

export interface ConflictAnalysisReport {
  readonly findings: AnalyzedConflict[]
  readonly truncated: boolean
  readonly comparedPairs: number
  readonly warning: string | null
}

export interface AnalyzedConflict {
  readonly identityKey: string
  readonly id: string
  readonly repositoryId: string
  readonly left: ConflictSide
  readonly right: ConflictSide
  readonly level: ConflictLevel
  readonly score: number
  readonly confidence: AttributionConfidence
  readonly headline: string
  readonly summary: string
  readonly recommendation: string
  readonly reasons: readonly string[]
  readonly evidence: readonly ConflictEvidenceItem[]
  readonly fingerprint: string
  readonly resources: readonly string[]
  readonly technical: ConflictTechnicalDetails
}

export interface ConflictTechnicalDetails {
  readonly leftBranch: string | null
  readonly rightBranch: string | null
  readonly leftWorktreePath: string | null
  readonly rightWorktreePath: string | null
  readonly leftHead: string | null
  readonly rightHead: string | null
  readonly commonBase: string | null
  readonly changedPaths: readonly string[]
}

export interface ScoreHit {
  readonly kind: string
  readonly score: number
  readonly label: string
  readonly leftPath?: string
  readonly rightPath?: string
  readonly resourceLabel?: string
}

export function analyzedToFinding(
  analyzed: AnalyzedConflict,
  extras: Pick<ConflictFinding, 'status' | 'detectedAt' | 'updatedAt' | 'resolvedAt'>,
): ConflictFinding {
  return {
    id: analyzed.id,
    identityKey: analyzed.identityKey,
    repositoryId: analyzed.repositoryId,
    leftSessionId: analyzed.left.sessionId,
    rightSessionId: analyzed.right.sessionId,
    leftWorktreePath: analyzed.left.worktreePath,
    rightWorktreePath: analyzed.right.worktreePath,
    leftSource: analyzed.left.source,
    rightSource: analyzed.right.source,
    leftAttributionConfidence: analyzed.left.attributionConfidence,
    rightAttributionConfidence: analyzed.right.attributionConfidence,
    level: analyzed.level,
    score: analyzed.score,
    confidence: analyzed.confidence,
    headline: analyzed.headline,
    summary: analyzed.summary,
    recommendation: analyzed.recommendation,
    reasons: analyzed.reasons,
    evidence: analyzed.evidence,
    fingerprint: analyzed.fingerprint,
    status: extras.status,
    detectedAt: extras.detectedAt,
    updatedAt: extras.updatedAt,
    resolvedAt: extras.resolvedAt,
  }
}

export const INACTIVE_SESSION_STATUSES = new Set<ExternalSessionStatus>([
  'completed',
  'failed',
  'ended',
  'stale',
])
