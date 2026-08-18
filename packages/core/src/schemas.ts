import { z } from 'zod'
import {
  approvalRisks,
  approvalStatuses,
  artifactTypes,
  jobStatuses,
  gardenStationIds,
  dirtyWorktreePolicies,
  jobWorktreeStatuses,
  packKinds,
  packSourceKinds,
  permissionProfileIds,
  providerCapabilityKeys,
  providerIds,
  employeeSources,
  providerSessionStatuses,
  runStatuses,
  runtimeProviderIds,
  shikumiEventTypes,
} from './domain.js'

export const registerWorkspaceRequestSchema = z.object({
  path: z.string().trim().min(1).max(4096),
})

export const repositorySchema = z.object({
  id: z.string().min(1),
  absolutePath: z.string().min(1),
  displayName: z.string().min(1),
  currentBranch: z.string().min(1).nullable(),
  remoteName: z.string().min(1).nullable(),
  remoteUrl: z.string().min(1).nullable(),
  readable: z.boolean(),
})

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  defaultProviderId: z.enum(providerIds).nullable(),
  worldPackId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  repository: repositorySchema,
})

export const providerSchema = z.object({
  id: z.enum(providerIds),
  displayName: z.string().min(1),
  executionConnected: z.boolean(),
})

export const providerAvailabilityStatuses = [
  'ready',
  'login_required',
  'not_installed',
  'capability_mismatch',
  'disconnected',
] as const

export const providerAvailabilitySchema = providerSchema.extend({
  installed: z.boolean().default(false),
  authenticated: z.boolean().default(false),
  status: z.enum(providerAvailabilityStatuses).default('disconnected'),
  capabilities: z.array(z.enum(providerCapabilityKeys)).default([]),
})

export type ProviderAvailability = z.infer<typeof providerAvailabilitySchema>

export const employeeSchema = z.object({
  id: z.string().min(1),
  packId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  defaultProviderId: z.enum(providerIds).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const employeeSummarySchema = employeeSchema.extend({
  description: z.string().min(1),
  version: z.string().min(1),
  permissionProfile: z.enum(permissionProfileIds),
  supportedJobTypes: z.array(z.string().min(1)).min(1),
  defaultProviderOrder: z.array(z.enum(providerIds)).min(1),
  requiredProviderCapabilities: z.array(z.enum(providerCapabilityKeys)),
  character: z.string().min(1),
  source: z.enum(employeeSources),
})

export const gardenStationSchema = z.enum(gardenStationIds)

export const employeeStateBindingSchema = z.object({
  station: gardenStationSchema,
  pose: z.string().min(1),
  summary: z.string().min(1),
})

export const jobSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  employeeId: z.string().min(1),
  request: z.string().min(1),
  jobType: z.string().min(1),
  selectedProvider: z.enum(runtimeProviderIds),
  selectedModel: z.string().min(1).nullable(),
  permissionProfile: z.enum(permissionProfileIds),
  status: z.enum(jobStatuses),
  providerSessionId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  startedAt: z.string().min(1).nullable(),
  completedAt: z.string().min(1).nullable(),
})

export const runSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  providerId: z.enum(runtimeProviderIds),
  status: z.enum(runStatuses),
  createdAt: z.string().min(1),
  startedAt: z.string().min(1).nullable(),
  completedAt: z.string().min(1).nullable(),
})

export const persistedEventSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1).nullable(),
  runId: z.string().min(1).nullable(),
  type: z.enum(shikumiEventTypes),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string().min(1),
})

export const approvalRequestSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  runId: z.string().min(1).nullable(),
  risk: z.enum(approvalRisks),
  summary: z.string().min(1),
  status: z.enum(approvalStatuses),
  createdAt: z.string().min(1),
  resolvedAt: z.string().min(1).nullable(),
})

export const artifactSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  type: z.enum(artifactTypes),
  title: z.string().min(1),
  storagePath: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
})

export const growthRecordSchema = z.object({
  id: z.string().min(1),
  employeeId: z.string().min(1),
  workspaceId: z.string().min(1).nullable(),
  metric: z.string().min(1),
  value: z.number().int(),
  createdAt: z.string().min(1),
})

export const installedPackSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(packKinds),
  packId: z.string().min(1),
  version: z.string().min(1),
  sourcePath: z.string().min(1).nullable(),
  sourceKind: z.enum(packSourceKinds).nullable().default(null),
  sourceDisplay: z.string().min(1).nullable().default(null),
  commitHash: z.string().min(1).nullable().default(null),
  builtin: z.boolean().default(false),
  installedAt: z.string().min(1),
})

export const jobWorktreeSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  repositoryId: z.string().min(1),
  worktreeRelPath: z.string().min(1),
  branchName: z.string().min(1),
  baseCommit: z.string().min(1),
  includeDirtyPatch: z.boolean(),
  status: z.enum(jobWorktreeStatuses),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const growthApplicationSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  employeeId: z.string().min(1),
  scopeKey: z.string().min(1),
  metric: z.string().min(1),
  value: z.number().int(),
  createdAt: z.string().min(1),
})

export const worldFeatureUnlockSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  worldPackId: z.string().min(1),
  unlockId: z.string().min(1),
  unlockedAt: z.string().min(1),
})

export const growthMetricSnapshotSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.number().int(),
})

export const growthSnapshotSchema = z.object({
  employeeId: z.string().min(1),
  employeeName: z.string().min(1),
  workspaceId: z.string().min(1).nullable(),
  level: z.number().int().min(1),
  permissionProfile: z.enum(permissionProfileIds),
  metrics: z.array(growthMetricSnapshotSchema),
  unlocks: z.array(z.string().min(1)),
})

export const portableGrowthExportSchema = z.object({
  generatedAt: z.string().min(1),
  employees: z.array(
    z.object({
      employeeId: z.string().min(1),
      employeeName: z.string().min(1),
      level: z.number().int().min(1),
      metrics: z.array(growthMetricSnapshotSchema),
      workspaces: z.array(
        z.object({
          workspaceId: z.string().min(1),
          workspaceName: z.string().min(1),
          level: z.number().int().min(1),
          metrics: z.array(growthMetricSnapshotSchema),
          unlocks: z.array(z.string().min(1)),
        }),
      ),
    }),
  ),
})

export const packPreviewSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(packKinds),
  packId: z.string().min(1),
  version: z.string().min(1),
  sourceKind: z.enum(['folder', 'zip', 'git']),
  sourceDisplay: z.string().min(1),
  validation: z.object({
    ok: z.boolean(),
    errors: z.array(z.string()),
  }),
  fileSummary: z.object({
    files: z.number().int().min(0),
    totalBytes: z.number().int().min(0),
    names: z.array(z.string()),
  }),
  gitCommit: z.string().min(1).nullable(),
  gitChanges: z.string().nullable(),
  createdAt: z.string().min(1),
})

export const packPreviewRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(packKinds),
  packId: z.string().min(1),
  version: z.string().min(1),
  sourceKind: z.enum(['folder', 'zip', 'git']),
  sourceDisplay: z.string().min(1),
  validation: z.record(z.string(), z.unknown()),
  fileSummary: z.record(z.string(), z.unknown()),
  gitCommit: z.string().min(1).nullable(),
  gitChanges: z.string().nullable(),
  stagingRelPath: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
})

export const providerSessionSchema = z.object({
  id: z.string().min(1),
  providerId: z.enum(runtimeProviderIds),
  providerSessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  employeeId: z.string().min(1),
  jobId: z.string().min(1),
  cwd: z.string().min(1),
  status: z.enum(providerSessionStatuses),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  details: z.record(z.string(), z.unknown()).optional(),
})

export const sessionResponseSchema = z.object({
  token: z.string().min(1),
})

export const createJobRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  employeeId: z.string().trim().min(1).max(128).optional(),
  request: z.string().trim().min(1).max(8000),
  jobType: z.string().trim().min(1).max(64).default('research'),
  selectedProvider: z.enum(runtimeProviderIds).optional(),
  confirmFallbackProvider: z.enum(runtimeProviderIds).optional(),
  permissionProfile: z.enum(permissionProfileIds).optional(),
  selectedModel: z.string().trim().min(1).max(128).optional(),
  dirtyWorktreePolicy: z.enum(dirtyWorktreePolicies).optional(),
})

export const confirmWriteRequestSchema = z.object({
  confirm: z.literal(true),
})

export const previewPackRequestSchema = z.object({
  sourceType: z.enum(['folder', 'zip', 'git']),
  path: z.string().trim().min(1).max(4096).optional(),
  gitUrl: z.string().trim().min(1).max(2048).optional(),
})

export const installPackRequestSchema = z.object({
  previewId: z.string().trim().min(1).max(128),
  confirm: z.literal(true),
})

export const updateWorkspaceRequestSchema = z.object({
  defaultProviderId: z.enum(providerIds).nullable(),
})

export const updateEmployeeRequestSchema = z.object({
  defaultProviderId: z.enum(providerIds).nullable(),
})

export const updateProviderSettingsRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  selectedModel: z.string().trim().min(1).max(128).nullable(),
})

export const resolveApprovalRequestSchema = z.object({
  decision: z.enum(['approved', 'denied']),
})

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  product: z.literal('Shikumi Local'),
  phase: z.string().min(1),
  bind: z.literal('127.0.0.1'),
  persistence: z.literal('sqlite'),
  providerExecution: z.enum(['disconnected', 'registry']),
  fakeHarness: z.boolean(),
  liveProviderRuns: z.boolean(),
})
