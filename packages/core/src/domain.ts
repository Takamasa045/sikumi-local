export const providerIds = ['codex', 'grok-build', 'claude-code'] as const
export type ProviderId = (typeof providerIds)[number]

export const runtimeProviderIds = [...providerIds, 'fake'] as const
export type RuntimeProviderId = (typeof runtimeProviderIds)[number]

export const FAKE_PROVIDER_ID = 'fake' as const

export const permissionProfileIds = [
  'observe',
  'research',
  'plan',
  'edit-worktree',
  'test-worktree',
  'publish',
  'unrestricted',
] as const
export type PermissionProfileId = (typeof permissionProfileIds)[number]

export const jobStatuses = [
  'queued',
  'preparing',
  'running',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
  'completed_with_invalid_result',
] as const
export type JobStatus = (typeof jobStatuses)[number]

export const runStatuses = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'orphaned',
] as const
export type RunStatus = (typeof runStatuses)[number]

export const providerSessionStatuses = [
  'active',
  'idle',
  'closed',
  'orphaned',
] as const
export type ProviderSessionStatus = (typeof providerSessionStatuses)[number]

export const approvalRisks = ['low', 'medium', 'high', 'critical'] as const
export type ApprovalRisk = (typeof approvalRisks)[number]

export const approvalStatuses = ['pending', 'approved', 'denied'] as const
export type ApprovalStatus = (typeof approvalStatuses)[number]

export const artifactTypes = [
  'report',
  'markdown',
  'code_diff',
  'patch',
  'test_result',
  'review',
  'plan',
  'handoff',
  'file',
  'link',
] as const
export type ArtifactType = (typeof artifactTypes)[number]

export const packKinds = ['employee', 'character', 'world'] as const
export type PackKind = (typeof packKinds)[number]

export const packSourceKinds = ['builtin', 'folder', 'zip', 'git'] as const
export type PackSourceKind = (typeof packSourceKinds)[number]

export const dirtyWorktreePolicies = [
  'from-head',
  'include-dirty-patch',
  'cancel',
] as const
export type DirtyWorktreePolicy = (typeof dirtyWorktreePolicies)[number]

export const jobWorktreeStatuses = [
  'prepared',
  'active',
  'completed',
  'applied',
  'discarded',
  'kept',
] as const
export type JobWorktreeStatus = (typeof jobWorktreeStatuses)[number]

export function requiresDedicatedWorktree(
  profile: PermissionProfileId,
): boolean {
  return profile === 'edit-worktree' || profile === 'test-worktree'
}

const permissionProfileRanks: Record<PermissionProfileId, number> = {
  observe: 0,
  plan: 1,
  research: 2,
  'edit-worktree': 3,
  'test-worktree': 4,
  publish: 5,
  unrestricted: 6,
}

export function permissionProfileRank(profile: PermissionProfileId): number {
  return permissionProfileRanks[profile]
}

export function isPermissionEscalation(
  requested: PermissionProfileId,
  allowed: PermissionProfileId,
): boolean {
  return permissionProfileRank(requested) > permissionProfileRank(allowed)
}

export const employeeSources = ['builtin', 'installed'] as const
export type EmployeeSource = (typeof employeeSources)[number]

export const CORE_EMPLOYEE_COMPATIBILITY = 1

export const providerCapabilityKeys = [
  'streaming',
  'structuredOutput',
  'sessionResume',
  'interruption',
  'liveApprovals',
  'liveQuestions',
  'readOnlySandbox',
  'workspaceWriteSandbox',
  'networkControl',
  'nativeWorktree',
  'modelListing',
  'usageReporting',
  'costReporting',
] as const
export type ProviderCapabilityKey = (typeof providerCapabilityKeys)[number]

export const gardenStationIds = [
  'archive',
  'observatory',
  'workbench',
  'waiting',
  'delivery',
  'rest',
] as const
export type GardenStationId = (typeof gardenStationIds)[number]

export const shikumiEventTypes = [
  'run.started',
  'run.state_changed',
  'repository.read',
  'web.search',
  'tool.started',
  'tool.completed',
  'command.started',
  'command.completed',
  'file.changed',
  'approval.requested',
  'approval.resolved',
  'user.question',
  'artifact.created',
  'usage.updated',
  'run.completed',
  'run.failed',
  'run.cancelled',
] as const
export type ShikumiEventType = (typeof shikumiEventTypes)[number]

export const runActivityStates = [
  'preparing',
  'reading_repository',
  'searching_web',
  'planning',
  'editing',
  'testing',
  'reviewing',
  'waiting_for_user',
  'organizing',
  'delivering',
] as const
export type RunActivityState = (typeof runActivityStates)[number]

export interface Provider {
  readonly id: ProviderId
  readonly displayName: string
  readonly executionConnected: boolean
}

export interface Repository {
  readonly id: string
  readonly absolutePath: string
  readonly displayName: string
  readonly currentBranch: string | null
  readonly remoteName: string | null
  readonly remoteUrl: string | null
  readonly readable: boolean
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly defaultProviderId: ProviderId | null
  readonly worldPackId: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly repository: Repository
}

export interface Employee {
  readonly id: string
  readonly packId: string
  readonly name: string
  readonly role: string
  readonly defaultProviderId: ProviderId | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface EmployeeSummary extends Employee {
  readonly description: string
  readonly version: string
  readonly permissionProfile: PermissionProfileId
  readonly supportedJobTypes: readonly string[]
  readonly defaultProviderOrder: readonly ProviderId[]
  readonly requiredProviderCapabilities: readonly ProviderCapabilityKey[]
  readonly character: string
  readonly source: EmployeeSource
}

export interface EmployeeInstance {
  readonly id: string
  readonly workspaceId: string
  readonly employeeId: string
  readonly characterPackId: string | null
  readonly createdAt: string
}

export interface ProviderSetting {
  readonly id: string
  readonly workspaceId: string
  readonly providerId: ProviderId
  readonly selectedModel: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface Job {
  readonly id: string
  readonly workspaceId: string
  readonly employeeId: string
  readonly request: string
  readonly jobType: string
  readonly selectedProvider: RuntimeProviderId
  readonly selectedModel: string | null
  readonly permissionProfile: PermissionProfileId
  readonly status: JobStatus
  readonly providerSessionId: string | null
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface Run {
  readonly id: string
  readonly jobId: string
  readonly providerId: RuntimeProviderId
  readonly status: RunStatus
  readonly createdAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface ProviderSession {
  readonly id: string
  readonly providerId: RuntimeProviderId
  readonly providerSessionId: string
  readonly workspaceId: string
  readonly employeeId: string
  readonly jobId: string
  readonly cwd: string
  readonly status: ProviderSessionStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PersistedEvent {
  readonly id: string
  readonly jobId: string | null
  readonly runId: string | null
  readonly type: ShikumiEventType
  readonly payload: Record<string, unknown>
  readonly occurredAt: string
}

export interface ApprovalRequest {
  readonly id: string
  readonly jobId: string
  readonly runId: string | null
  readonly risk: ApprovalRisk
  readonly summary: string
  readonly status: ApprovalStatus
  readonly createdAt: string
  readonly resolvedAt: string | null
}

export interface UserQuestion {
  readonly id: string
  readonly jobId: string
  readonly prompt: string
  readonly status: 'pending' | 'answered'
  readonly answer: string | null
  readonly createdAt: string
  readonly answeredAt: string | null
}

export interface Artifact {
  readonly id: string
  readonly jobId: string
  readonly type: ArtifactType
  readonly title: string
  readonly storagePath: string | null
  readonly createdAt: string
}

export interface GrowthRecord {
  readonly id: string
  readonly employeeId: string
  readonly workspaceId: string | null
  readonly metric: string
  readonly value: number
  readonly createdAt: string
}

export interface WorldUnlock {
  readonly id: string
  readonly workspaceId: string
  readonly worldPackId: string
  readonly unlockedAt: string
}

export interface AuditEntry {
  readonly id: string
  readonly action: string
  readonly subjectType: string
  readonly subjectId: string
  readonly details: Record<string, unknown>
  readonly createdAt: string
}

export interface InstalledPack {
  readonly id: string
  readonly kind: PackKind
  readonly packId: string
  readonly version: string
  readonly sourcePath: string | null
  readonly sourceKind: PackSourceKind | null
  readonly sourceDisplay: string | null
  readonly commitHash: string | null
  readonly builtin: boolean
  readonly installedAt: string
}

export interface JobWorktree {
  readonly id: string
  readonly jobId: string
  readonly repositoryId: string
  readonly worktreeRelPath: string
  readonly branchName: string
  readonly baseCommit: string
  readonly includeDirtyPatch: boolean
  readonly status: JobWorktreeStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface GrowthApplication {
  readonly id: string
  readonly jobId: string
  readonly employeeId: string
  readonly scopeKey: string
  readonly metric: string
  readonly value: number
  readonly createdAt: string
}

export interface WorldFeatureUnlock {
  readonly id: string
  readonly workspaceId: string
  readonly worldPackId: string
  readonly unlockId: string
  readonly unlockedAt: string
}

export interface PackPreviewRecord {
  readonly id: string
  readonly kind: PackKind
  readonly packId: string
  readonly version: string
  readonly sourceKind: Exclude<PackSourceKind, 'builtin'>
  readonly sourceDisplay: string
  readonly validation: Record<string, unknown>
  readonly fileSummary: Record<string, unknown>
  readonly gitCommit: string | null
  readonly gitChanges: string | null
  readonly stagingRelPath: string
  readonly createdAt: string
  readonly expiresAt: string
}

export const defaultProviders: readonly Provider[] = [
  { id: 'codex', displayName: 'Codex', executionConnected: false },
  { id: 'grok-build', displayName: 'Grok Build', executionConnected: false },
  { id: 'claude-code', displayName: 'Claude Code', executionConnected: false },
]

export function isProviderId(value: string): value is ProviderId {
  return (providerIds as readonly string[]).includes(value)
}

export function isRuntimeProviderId(value: string): value is RuntimeProviderId {
  return (runtimeProviderIds as readonly string[]).includes(value)
}

export function isShikumiEventType(value: string): value is ShikumiEventType {
  return (shikumiEventTypes as readonly string[]).includes(value)
}

export function isProviderCapabilityKey(
  value: string,
): value is ProviderCapabilityKey {
  return (providerCapabilityKeys as readonly string[]).includes(value)
}

export function isGardenStationId(value: string): value is GardenStationId {
  return (gardenStationIds as readonly string[]).includes(value)
}
