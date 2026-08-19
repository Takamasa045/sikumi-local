import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  employeeName: text('employee_name'),
  defaultProviderId: text('default_provider_id'),
  worldPackId: text('world_pack_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  absolutePath: text('absolute_path').notNull().unique(),
  displayName: text('display_name').notNull(),
  currentBranch: text('current_branch'),
  remoteName: text('remote_name'),
  remoteUrl: text('remote_url'),
  readable: integer('readable', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const employees = sqliteTable('employees', {
  id: text('id').primaryKey(),
  packId: text('pack_id').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  defaultProviderId: text('default_provider_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const employeeInstances = sqliteTable(
  'employee_instances',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    characterPackId: text('character_pack_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique().on(table.workspaceId, table.employeeId)],
)

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  executionConnected: integer('execution_connected', {
    mode: 'boolean',
  }).notNull(),
})

export const providerSettings = sqliteTable(
  'provider_settings',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id),
    selectedModel: text('selected_model'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [unique().on(table.workspaceId, table.providerId)],
)

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  employeeId: text('employee_id').notNull(),
  request: text('request').notNull(),
  jobType: text('job_type').notNull(),
  selectedProvider: text('selected_provider').notNull(),
  selectedModel: text('selected_model'),
  permissionProfile: text('permission_profile').notNull(),
  status: text('status').notNull(),
  providerSessionId: text('provider_session_id'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
})

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
})

export const providerSessions = sqliteTable('provider_sessions', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  providerSessionId: text('provider_session_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  employeeId: text('employee_id').notNull(),
  jobId: text('job_id').notNull(),
  cwd: text('cwd').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  jobId: text('job_id'),
  runId: text('run_id'),
  type: text('type').notNull(),
  payload: text('payload').notNull(),
  occurredAt: text('occurred_at').notNull(),
})

export const approvalRequests = sqliteTable('approval_requests', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  runId: text('run_id'),
  risk: text('risk').notNull(),
  summary: text('summary').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
})

export const userQuestions = sqliteTable('user_questions', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull(),
  answer: text('answer'),
  createdAt: text('created_at').notNull(),
  answeredAt: text('answered_at'),
})

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  storagePath: text('storage_path'),
  createdAt: text('created_at').notNull(),
})

export const growthRecords = sqliteTable('growth_records', {
  id: text('id').primaryKey(),
  employeeId: text('employee_id').notNull(),
  workspaceId: text('workspace_id'),
  metric: text('metric').notNull(),
  value: integer('value').notNull(),
  createdAt: text('created_at').notNull(),
})

export const worldUnlocks = sqliteTable(
  'world_unlocks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    worldPackId: text('world_pack_id').notNull(),
    unlockedAt: text('unlocked_at').notNull(),
  },
  (table) => [unique().on(table.workspaceId, table.worldPackId)],
)

export const auditEntries = sqliteTable('audit_entries', {
  id: text('id').primaryKey(),
  action: text('action').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  details: text('details').notNull(),
  createdAt: text('created_at').notNull(),
})

export const installedPacks = sqliteTable(
  'installed_packs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    packId: text('pack_id').notNull(),
    version: text('version').notNull(),
    sourcePath: text('source_path'),
    sourceKind: text('source_kind'),
    sourceDisplay: text('source_display'),
    commitHash: text('commit_hash'),
    builtin: integer('builtin', { mode: 'boolean' }).notNull(),
    installedAt: text('installed_at').notNull(),
  },
  (table) => [unique().on(table.kind, table.packId)],
)

export const jobWorktrees = sqliteTable('job_worktrees', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .unique()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  repositoryId: text('repository_id').notNull(),
  worktreeRelPath: text('worktree_rel_path').notNull(),
  branchName: text('branch_name').notNull(),
  baseCommit: text('base_commit').notNull(),
  includeDirtyPatch: integer('include_dirty_patch', {
    mode: 'boolean',
  }).notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const growthApplications = sqliteTable(
  'growth_applications',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull(),
    employeeId: text('employee_id').notNull(),
    scopeKey: text('scope_key').notNull(),
    metric: text('metric').notNull(),
    value: integer('value').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    unique().on(table.jobId, table.employeeId, table.scopeKey, table.metric),
  ],
)

export const worldFeatureUnlocks = sqliteTable(
  'world_feature_unlocks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    worldPackId: text('world_pack_id').notNull(),
    unlockId: text('unlock_id').notNull(),
    unlockedAt: text('unlocked_at').notNull(),
  },
  (table) => [
    unique().on(table.workspaceId, table.worldPackId, table.unlockId),
  ],
)

export const observerAdapters = sqliteTable('observer_adapters', {
  id: text('id').primaryKey(),
  source: text('source').notNull().unique(),
  displayName: text('display_name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  installationStatus: text('installation_status').notNull(),
  installedVersion: text('installed_version'),
  detectedVersion: text('detected_version'),
  lastEventAt: text('last_event_at'),
  healthJson: text('health_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const externalSessions = sqliteTable('external_sessions', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  surface: text('surface').notNull(),
  externalSessionId: text('external_session_id'),
  workspaceId: text('workspace_id'),
  repositoryId: text('repository_id'),
  cwd: text('cwd'),
  worktreePath: text('worktree_path'),
  branch: text('branch'),
  baseCommit: text('base_commit'),
  headCommit: text('head_commit'),
  title: text('title'),
  status: text('status').notNull(),
  activity: text('activity').notNull(),
  attributionConfidence: text('attribution_confidence').notNull(),
  startedAt: text('started_at').notNull(),
  lastObservedAt: text('last_observed_at').notNull(),
  endedAt: text('ended_at'),
})

export const observerEvents = sqliteTable('observer_events', {
  id: text('id').primaryKey(),
  externalSessionId: text('external_session_id'),
  repositoryId: text('repository_id'),
  source: text('source').notNull(),
  nativeEventType: text('native_event_type').notNull(),
  normalizedType: text('normalized_type').notNull(),
  payloadJson: text('payload_json').notNull(),
  occurredAt: text('occurred_at').notNull(),
  receivedAt: text('received_at').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
})

export const resourceClaims = sqliteTable('resource_claims', {
  id: text('id').primaryKey(),
  externalSessionId: text('external_session_id'),
  repositoryId: text('repository_id'),
  resourceType: text('resource_type').notNull(),
  resourceKey: text('resource_key').notNull(),
  action: text('action').notNull(),
  claimKind: text('claim_kind').notNull(),
  confidence: text('confidence').notNull(),
  firstObservedAt: text('first_observed_at').notNull(),
  lastObservedAt: text('last_observed_at').notNull(),
})

export const repositorySnapshots = sqliteTable('repository_snapshots', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').notNull(),
  worktreePath: text('worktree_path').notNull(),
  branch: text('branch'),
  headCommit: text('head_commit'),
  baseCommit: text('base_commit'),
  statusJson: text('status_json').notNull(),
  changedFilesJson: text('changed_files_json').notNull(),
  createdAt: text('created_at').notNull(),
})

export const conflictFindings = sqliteTable('conflict_findings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').notNull(),
  leftSessionId: text('left_session_id'),
  rightSessionId: text('right_session_id'),
  leftWorktreePath: text('left_worktree_path'),
  rightWorktreePath: text('right_worktree_path'),
  leftSource: text('left_source'),
  rightSource: text('right_source'),
  leftAttributionConfidence: text('left_attribution_confidence'),
  rightAttributionConfidence: text('right_attribution_confidence'),
  level: text('level').notNull(),
  score: integer('score').notNull(),
  confidence: text('confidence').notNull(),
  headline: text('headline'),
  summary: text('summary').notNull(),
  recommendation: text('recommendation'),
  reasonJson: text('reason_json').notNull(),
  evidenceJson: text('evidence_json'),
  identityKey: text('identity_key'),
  fingerprint: text('fingerprint'),
  status: text('status').notNull(),
  detectedAt: text('detected_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  resolvedAt: text('resolved_at'),
})

export const sessionLabels = sqliteTable('session_labels', {
  id: text('id').primaryKey(),
  externalSessionId: text('external_session_id').notNull().unique(),
  title: text('title'),
  summary: text('summary'),
  source: text('source').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const packPreviews = sqliteTable('pack_previews', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  packId: text('pack_id').notNull(),
  version: text('version').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceDisplay: text('source_display').notNull(),
  validationJson: text('validation_json').notNull(),
  fileSummaryJson: text('file_summary_json').notNull(),
  gitCommit: text('git_commit'),
  gitChanges: text('git_changes'),
  stagingRelPath: text('staging_rel_path').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})
