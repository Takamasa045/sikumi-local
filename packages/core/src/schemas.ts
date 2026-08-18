import { z } from 'zod'
import {
  approvalRisks,
  approvalStatuses,
  artifactTypes,
  jobStatuses,
  packKinds,
  permissionProfileIds,
  providerIds,
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

export const employeeSchema = z.object({
  id: z.string().min(1),
  packId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  defaultProviderId: z.enum(providerIds).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
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
  installedAt: z.string().min(1),
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
  request: z.string().trim().min(1).max(8000),
  jobType: z.string().trim().min(1).max(64).default('research'),
  selectedProvider: z.enum(runtimeProviderIds).optional(),
  confirmFallbackProvider: z.enum(runtimeProviderIds).optional(),
  permissionProfile: z.enum(permissionProfileIds).optional(),
  selectedModel: z.string().trim().min(1).max(128).optional(),
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
