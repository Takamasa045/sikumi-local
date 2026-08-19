export {
  classifyConflictPath,
  directoryOf,
  extractMigrationNumber,
  isGeneratedPath,
  isLockfilePath,
  isPackageManifestPath,
  normalizeConflictPath,
  packageNameOf,
  sharedSignificantTokens,
} from './classify.js'
export {
  analyzeConflictPair,
  analyzeRepositoryConflicts,
  analyzeRepositoryConflictsReport,
  buildConflictSides,
} from './engine.js'
export {
  actorDisplayName,
  canNameConflictActor,
  explainHits,
  pairActorPhrase,
  safeActorLabel,
} from './explain.js'
export {
  actorKey,
  conflictFingerprint,
  conflictIdFromKey,
  conflictIdentityKey,
  orderedSides,
  sameConflictActor,
} from './identity.js'
export {
  applyConflictTransition,
  reconcileConflictFindings,
} from './reconcile.js'
export {
  CONFLICT_RULE_SCORES,
  claimPathKeys,
  effectiveClaims,
  maxScore,
  scoreClaimPair,
  scoreSides,
} from './scoring.js'
export {
  INACTIVE_SESSION_STATUSES,
  analyzedToFinding,
  type AnalyzedConflict,
  type AnalyzeRepositoryConflictsInput,
  type ConflictAnalysisReport,
  type ConflictClaimInput,
  type ConflictSide,
  type ConflictTechnicalDetails,
  type ConflictWorktreeInput,
  type ScoreHit,
} from './types.js'
