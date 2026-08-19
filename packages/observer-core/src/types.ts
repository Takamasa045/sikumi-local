export const OBSERVER_SCHEMA_VERSION = 1 as const

export const observerSourceIds = [
  'codex',
  'cursor',
  'grok-build',
  'claude-code',
  'claude-desktop',
  'git',
] as const
export type ObserverSourceId = (typeof observerSourceIds)[number]

export const observerSurfaces = [
  'desktop-app',
  'cli',
  'ide',
  'mcp',
  'cursor-tab',
  'cursor-agent',
  'cursor-cli',
  'unknown',
] as const
export type ObserverSurface = (typeof observerSurfaces)[number]

export const observerNormalizedTypes = [
  'session.started',
  'session.ended',
  'session.failed',
  'prompt.submitted',
  'activity.changed',
  'file.read',
  'file.changed',
  'command.started',
  'command.completed',
  'permission.requested',
  'permission.resolved',
  'subagent.started',
  'subagent.stopped',
  'task.created',
  'task.completed',
  'worktree.created',
  'worktree.removed',
  'user.input_required',
  'heartbeat',
] as const
export type ObserverNormalizedType = (typeof observerNormalizedTypes)[number]

export const observerActorKinds = [
  'agent',
  'subagent',
  'human',
  'unknown',
] as const
export type ObserverActorKind = (typeof observerActorKinds)[number]

export const observerActivities = [
  'starting',
  'planning',
  'reading',
  'editing',
  'running-command',
  'testing',
  'reviewing',
  'waiting-for-user',
  'idle',
  'completed',
  'failed',
  'unknown',
] as const
export type ObserverActivity = (typeof observerActivities)[number]

export const attributionConfidences = [
  'verified',
  'reported',
  'correlated',
  'inferred',
  'unknown',
] as const
export type AttributionConfidence = (typeof attributionConfidences)[number]

export const ingestionMethods = [
  'hook',
  'plugin',
  'mcp',
  'stream-json',
  'git-scan',
  'http',
] as const
export type IngestionMethod = (typeof ingestionMethods)[number]

export const resourceTypes = [
  'file',
  'directory',
  'package',
  'api',
  'schema',
  'database',
  'config',
  'component',
  'command',
  'worktree',
] as const
export type ResourceType = (typeof resourceTypes)[number]

export const resourceActions = [
  'read',
  'write',
  'create',
  'delete',
  'execute',
] as const
export type ResourceAction = (typeof resourceActions)[number]

export const resourceClaimKinds = ['planned', 'observed'] as const
export type ResourceClaimKind = (typeof resourceClaimKinds)[number]

export const externalSessionStatuses = [
  'detected',
  'active',
  'waiting-for-user',
  'idle',
  'completed',
  'failed',
  'ended',
  'stale',
  'unknown',
] as const
export type ExternalSessionStatus = (typeof externalSessionStatuses)[number]

export const conflictLevels = [
  'safe',
  'related',
  'caution',
  'high',
  'critical',
] as const
export type ConflictLevel = (typeof conflictLevels)[number]

export const conflictFindingStatuses = [
  'open',
  'acknowledged',
  'resolved',
] as const
export type ConflictFindingStatus = (typeof conflictFindingStatuses)[number]

export const adapterInstallationStatuses = [
  'not_installed',
  'needs_review',
  'ready',
  'degraded',
  'needs_update',
  'unavailable',
  'error',
] as const
export type AdapterInstallationStatus =
  (typeof adapterInstallationStatuses)[number]

export const observerInstallScopes = ['user', 'repo'] as const
export type ObserverInstallScope = (typeof observerInstallScopes)[number]

export const observerInstallFileActions = [
  'create',
  'update',
  'remove',
  'keep',
] as const
export type ObserverInstallFileAction =
  (typeof observerInstallFileActions)[number]

export const observerChangeTypes = [
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'unmerged',
] as const
export type ObserverChangeType = (typeof observerChangeTypes)[number]

export interface ObserverCapabilities {
  readonly sessionLifecycle: boolean
  readonly fileEvents: boolean
  readonly commandEvents: boolean
  readonly permissionEvents: boolean
  readonly subagentEvents: boolean
  readonly worktreeEvents: boolean
  readonly taskMetadata: boolean
  readonly cooperativeReporting: boolean
}

export interface ObserverHealth {
  readonly ok: boolean
  readonly status: AdapterInstallationStatus
  readonly detectedVersion: string | null
  readonly supportedRange: string | null
  readonly lastEventAt: string | null
  readonly warnings: readonly string[]
  readonly errors: readonly string[]
}

export interface ObserverInstallOptions {
  readonly confirm?: boolean
  readonly homeDir?: string
  readonly repoDir?: string | null
  readonly scope?: ObserverInstallScope
  readonly repositoryId?: string
  /** Plan digest for TOCTOU detection. Not an authorization token. */
  readonly confirmationToken?: string
  /** SHA-256 of the previewed plan. Detects setting changes before apply. */
  readonly planDigest?: string
  /**
   * Server-internal only. Public request schema cannot set this.
   * Grants apply to the real user home after CSRF/auth and a matching plan digest.
   */
  readonly allowRealUserApply?: boolean
  /** Test injection for real-home detection. Callers should not send this on the public API. */
  readonly env?: NodeJS.ProcessEnv
  readonly lastEventAt?: string | null
  readonly dataDirectory?: string
  readonly now?: string
}

export interface ObserverInstallFilePlan {
  readonly path: string
  readonly action: ObserverInstallFileAction
  readonly preview: string
  readonly previous?: string
}

export interface ObserverInstallResult {
  readonly ok: boolean
  readonly changed: boolean
  readonly message: string
  readonly preview?: string
  readonly requiresConfirm?: boolean
  readonly applied?: boolean
  readonly files?: readonly ObserverInstallFilePlan[]
  readonly evidence?: readonly string[]
  /** Same value as planDigest. Kept as an alias; not an authorization token. */
  readonly confirmationToken?: string
  readonly planDigest?: string
  readonly targetRoot?: string
}

export interface ObserverResource {
  readonly type: ResourceType
  readonly key: string
  readonly action: ResourceAction
}

export interface NormalizedObserverEvent {
  readonly id: string
  readonly schemaVersion: typeof OBSERVER_SCHEMA_VERSION
  readonly occurredAt: string
  readonly receivedAt: string
  readonly source: ObserverSourceId
  readonly surface: ObserverSurface
  readonly nativeEventType: string
  readonly normalizedType: ObserverNormalizedType
  readonly externalSessionId: string | null
  readonly externalTurnId: string | null
  readonly externalTaskId: string | null
  readonly externalSubagentId: string | null
  readonly cwd: string | null
  readonly repositoryId: string | null
  readonly worktreePath: string | null
  readonly branch: string | null
  readonly baseCommit: string | null
  readonly headCommit: string | null
  readonly actorKind: ObserverActorKind
  readonly activity: ObserverActivity
  readonly resource: ObserverResource | null
  readonly summary: string | null
  readonly attributionConfidence: AttributionConfidence
  readonly ingestionMethod: IngestionMethod
  readonly idempotencyKey: string
  readonly payload: Record<string, string>
}

export interface ExternalSession {
  readonly id: string
  readonly source: ObserverSourceId
  readonly surface: ObserverSurface
  readonly externalSessionId: string | null
  readonly workspaceId: string | null
  readonly repositoryId: string | null
  readonly cwd: string | null
  readonly worktreePath: string | null
  readonly branch: string | null
  readonly baseCommit: string | null
  readonly headCommit: string | null
  readonly title: string | null
  readonly status: ExternalSessionStatus
  readonly activity: ObserverActivity
  readonly attributionConfidence: AttributionConfidence
  readonly startedAt: string
  readonly lastObservedAt: string
  readonly endedAt: string | null
}

export interface ResourceClaim {
  readonly id: string
  readonly externalSessionId: string | null
  readonly repositoryId: string | null
  readonly resourceType: ResourceType
  readonly resourceKey: string
  readonly action: ResourceAction
  readonly claimKind: ResourceClaimKind
  readonly confidence: AttributionConfidence
  readonly firstObservedAt: string
  readonly lastObservedAt: string
}

export interface SessionLabel {
  readonly id: string
  readonly externalSessionId: string
  readonly title: string | null
  readonly summary: string | null
  readonly source: 'user' | 'system'
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ConflictEvidenceItem {
  readonly kind: string
  readonly label: string
  readonly leftPath?: string | undefined
  readonly rightPath?: string | undefined
}

export interface ConflictFinding {
  readonly id: string
  readonly identityKey: string
  readonly repositoryId: string
  readonly leftSessionId: string | null
  readonly rightSessionId: string | null
  readonly leftWorktreePath: string | null
  readonly rightWorktreePath: string | null
  readonly leftSource: ObserverSourceId | null
  readonly rightSource: ObserverSourceId | null
  readonly leftAttributionConfidence: AttributionConfidence
  readonly rightAttributionConfidence: AttributionConfidence
  readonly level: ConflictLevel
  readonly score: number
  readonly confidence: AttributionConfidence
  readonly headline: string
  readonly summary: string
  readonly recommendation: string
  readonly reasons: readonly string[]
  readonly evidence: readonly ConflictEvidenceItem[]
  readonly fingerprint: string
  readonly status: ConflictFindingStatus
  readonly detectedAt: string
  readonly updatedAt: string
  readonly resolvedAt: string | null
}

export interface ObserverAdapterRecord {
  readonly id: string
  readonly source: ObserverSourceId
  readonly displayName: string
  readonly enabled: boolean
  readonly installationStatus: AdapterInstallationStatus
  readonly installedVersion: string | null
  readonly detectedVersion: string | null
  readonly lastEventAt: string | null
  readonly health: ObserverHealth
  readonly createdAt: string
  readonly updatedAt: string
}

export const GIT_OBSERVER_CAPABILITIES: ObserverCapabilities = {
  sessionLifecycle: false,
  fileEvents: false,
  commandEvents: false,
  permissionEvents: false,
  subagentEvents: false,
  worktreeEvents: true,
  taskMetadata: false,
  cooperativeReporting: false,
}

export const DIRECT_HOOK_CAPABILITIES: ObserverCapabilities = {
  sessionLifecycle: true,
  fileEvents: true,
  commandEvents: true,
  permissionEvents: true,
  subagentEvents: true,
  worktreeEvents: true,
  taskMetadata: true,
  cooperativeReporting: false,
}

export const COOPERATIVE_CAPABILITIES: ObserverCapabilities = {
  sessionLifecycle: true,
  fileEvents: true,
  commandEvents: false,
  permissionEvents: false,
  subagentEvents: false,
  worktreeEvents: false,
  taskMetadata: true,
  cooperativeReporting: true,
}

export function isObserverSourceId(value: string): value is ObserverSourceId {
  return (observerSourceIds as readonly string[]).includes(value)
}

export function isObserverNormalizedType(
  value: string,
): value is ObserverNormalizedType {
  return (observerNormalizedTypes as readonly string[]).includes(value)
}

export function isAttributionConfidence(
  value: string,
): value is AttributionConfidence {
  return (attributionConfidences as readonly string[]).includes(value)
}

export function isExternalSessionStatus(
  value: string,
): value is ExternalSessionStatus {
  return (externalSessionStatuses as readonly string[]).includes(value)
}

export function installationStatusLabel(
  status: AdapterInstallationStatus,
): string {
  switch (status) {
    case 'not_installed':
      return '未導入'
    case 'needs_review':
      return '要レビュー'
    case 'ready':
      return '有効'
    case 'degraded':
      return '劣化'
    case 'needs_update':
      return '更新が必要'
    case 'unavailable':
      return '利用できません'
    case 'error':
      return 'エラー'
  }
}

export function isEnabledInstallationStatus(
  status: AdapterInstallationStatus,
): boolean {
  return (
    status === 'ready' || status === 'needs_review' || status === 'degraded'
  )
}

export function displayNameForSource(source: ObserverSourceId): string {
  switch (source) {
    case 'codex':
      return 'Codex'
    case 'cursor':
      return 'Cursor'
    case 'grok-build':
      return 'Grok Build'
    case 'claude-code':
      return 'Claude Code'
    case 'claude-desktop':
      return 'Claudeアプリ'
    case 'git':
      return '変更元不明'
  }
}

export function confidenceLabel(confidence: AttributionConfidence): string {
  switch (confidence) {
    case 'verified':
      return '確認済み'
    case 'reported':
      return '自己申告'
    case 'correlated':
      return '高い可能性'
    case 'inferred':
      return '変更元不明'
    case 'unknown':
      return '関連付けできません'
  }
}

export function conflictTone(level: ConflictLevel): string {
  switch (level) {
    case 'safe':
      return '別々に進められそうです'
    case 'related':
      return '一部が関係しています'
    case 'caution':
      return '完了順を調整した方が安全です'
    case 'high':
      return '同じ仕組みを変更しています'
    case 'critical':
      return '同じファイルを片方は消し、もう片方は直しています'
  }
}

export function conflictHeadline(level: ConflictLevel): string {
  switch (level) {
    case 'safe':
      return '🟢 別々に進められそうです'
    case 'related':
      return '🟡 一部が関係しています'
    case 'caution':
      return '🟠 完了順を調整した方が安全です'
    case 'high':
    case 'critical':
      return '🔴 同じ仕組みを変更しています'
  }
}

export const CONFLICT_SCORE_BANDS = {
  safe: { min: 0, max: 29 },
  related: { min: 30, max: 59 },
  caution: { min: 60, max: 79 },
  high: { min: 80, max: 89 },
  critical: { min: 90, max: 100 },
} as const

export function scoreToConflictLevel(score: number): ConflictLevel {
  if (score >= 80) {
    return score >= 90 ? 'critical' : 'high'
  }
  if (score >= 60) {
    return 'caution'
  }
  if (score >= 30) {
    return 'related'
  }
  return 'safe'
}
