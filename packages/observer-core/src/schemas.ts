import { z } from 'zod'
import { normalizeObserverDateTime } from './datetime.js'
import {
  OBSERVER_MAX_BATCH_COUNT,
  OBSERVER_MAX_CONFLICT_EVIDENCE,
  OBSERVER_MAX_CONFLICT_REASONS,
  OBSERVER_MAX_PATH_CHARS,
  OBSERVER_MAX_PAYLOAD_KEYS,
  OBSERVER_MAX_PAYLOAD_VALUE,
  OBSERVER_MAX_SUMMARY_CHARS,
  OBSERVER_UI_MAX_CONFLICTS,
  OBSERVER_UI_MAX_FILES,
  OBSERVER_UI_MAX_REPOSITORIES,
  OBSERVER_UI_MAX_SESSIONS,
} from './limits.js'
import {
  adapterInstallationStatuses,
  attentionKinds,
  attentionSeverities,
  attributionConfidences,
  conflictFindingStatuses,
  conflictLevels,
  externalSessionStatuses,
  ingestionMethods,
  OBSERVER_SCHEMA_VERSION,
  observerActivities,
  observerActorKinds,
  observerNormalizedTypes,
  observerSourceIds,
  observerSurfaces,
  resourceActions,
  resourceClaimKinds,
  resourceTypes,
} from './types.js'

const isoDate = z.string().transform((value, ctx) => {
  const normalized = normalizeObserverDateTime(value)
  if (!normalized) {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid RFC3339 / ISO-8601 datetime',
    })
    return z.NEVER
  }
  return normalized
})
const shortText = z.string().min(1).max(512)
const pathText = z.string().min(1).max(OBSERVER_MAX_PATH_CHARS)
const nullablePath = pathText.nullable()
const nullableText = z.string().min(1).max(512).nullable()

export const observerResourceSchema = z.object({
  type: z.enum(resourceTypes),
  key: pathText,
  action: z.enum(resourceActions),
})

export const observerPayloadSchema = z
  .record(z.string().max(128), z.string().max(OBSERVER_MAX_PAYLOAD_VALUE))
  .refine((value) => Object.keys(value).length <= OBSERVER_MAX_PAYLOAD_KEYS, {
    message: 'Observer payload has too many keys',
  })

export const normalizedObserverEventSchema = z.object({
  id: z.string().min(1).max(128),
  schemaVersion: z.literal(OBSERVER_SCHEMA_VERSION),
  occurredAt: isoDate,
  receivedAt: isoDate,
  source: z.enum(observerSourceIds),
  surface: z.enum(observerSurfaces),
  nativeEventType: shortText,
  normalizedType: z.enum(observerNormalizedTypes),
  externalSessionId: nullableText,
  externalTurnId: nullableText,
  externalTaskId: nullableText,
  externalSubagentId: nullableText,
  cwd: nullablePath,
  repositoryId: nullableText,
  worktreePath: nullablePath,
  branch: nullableText,
  baseCommit: nullableText,
  headCommit: nullableText,
  actorKind: z.enum(observerActorKinds),
  activity: z.enum(observerActivities),
  resource: observerResourceSchema.nullable(),
  summary: z.string().min(1).max(OBSERVER_MAX_SUMMARY_CHARS).nullable(),
  attributionConfidence: z.enum(attributionConfidences),
  ingestionMethod: z.enum(ingestionMethods),
  idempotencyKey: z.string().min(8).max(128),
  payload: observerPayloadSchema,
})

export const inboundObserverEventSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    schemaVersion: z.literal(OBSERVER_SCHEMA_VERSION).optional(),
    occurredAt: isoDate.optional(),
    source: z.enum(observerSourceIds),
    surface: z.enum(observerSurfaces).optional(),
    nativeEventType: z.string().min(1).max(512).optional(),
    normalizedType: z.enum(observerNormalizedTypes).optional(),
    externalSessionId: z.string().min(1).max(512).nullable().optional(),
    externalTurnId: z.string().min(1).max(512).nullable().optional(),
    externalTaskId: z.string().min(1).max(512).nullable().optional(),
    externalSubagentId: z.string().min(1).max(512).nullable().optional(),
    cwd: z.string().min(1).max(4096).nullable().optional(),
    repositoryId: z.string().min(1).max(128).nullable().optional(),
    worktreePath: z.string().min(1).max(4096).nullable().optional(),
    branch: z.string().min(1).max(512).nullable().optional(),
    baseCommit: z.string().min(1).max(128).nullable().optional(),
    headCommit: z.string().min(1).max(128).nullable().optional(),
    actorKind: z.enum(observerActorKinds).optional(),
    activity: z.enum(observerActivities).optional(),
    resource: observerResourceSchema.nullable().optional(),
    summary: z.string().min(1).max(OBSERVER_MAX_SUMMARY_CHARS).nullable().optional(),
    attributionConfidence: z.enum(attributionConfidences).optional(),
    ingestionMethod: z.enum(ingestionMethods).optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export const inboundObserverBatchSchema = z.object({
  events: z.array(inboundObserverEventSchema).min(1).max(OBSERVER_MAX_BATCH_COUNT),
})

export const observerHealthSchema = z.object({
  ok: z.boolean(),
  status: z.enum(adapterInstallationStatuses),
  detectedVersion: z.string().min(1).max(128).nullable(),
  supportedRange: z.string().min(1).max(128).nullable(),
  lastEventAt: isoDate.nullable(),
  warnings: z.array(z.string().max(280)).max(20),
  errors: z.array(z.string().max(280)).max(20),
})

export const observerAdapterRecordSchema = z.object({
  id: z.string().min(1),
  source: z.enum(observerSourceIds),
  displayName: shortText,
  enabled: z.boolean(),
  installationStatus: z.enum(adapterInstallationStatuses),
  installedVersion: z.string().min(1).max(128).nullable(),
  detectedVersion: z.string().min(1).max(128).nullable(),
  lastEventAt: isoDate.nullable(),
  health: observerHealthSchema,
  createdAt: isoDate,
  updatedAt: isoDate,
})

export const externalSessionSchema = z.object({
  id: z.string().min(1),
  source: z.enum(observerSourceIds),
  surface: z.enum(observerSurfaces),
  externalSessionId: nullableText,
  workspaceId: nullableText,
  repositoryId: nullableText,
  cwd: nullablePath,
  worktreePath: nullablePath,
  branch: nullableText,
  baseCommit: nullableText,
  headCommit: nullableText,
  title: z.string().min(1).max(160).nullable(),
  status: z.enum(externalSessionStatuses),
  activity: z.enum(observerActivities),
  attributionConfidence: z.enum(attributionConfidences),
  startedAt: isoDate,
  lastObservedAt: isoDate,
  endedAt: isoDate.nullable(),
})

export const resourceClaimSchema = z.object({
  id: z.string().min(1),
  externalSessionId: nullableText,
  repositoryId: nullableText,
  resourceType: z.enum(resourceTypes),
  resourceKey: pathText,
  action: z.enum(resourceActions),
  claimKind: z.enum(resourceClaimKinds),
  confidence: z.enum(attributionConfidences),
  firstObservedAt: isoDate,
  lastObservedAt: isoDate,
})

export const sessionLabelSchema = z.object({
  id: z.string().min(1),
  externalSessionId: z.string().min(1),
  title: z.string().min(1).max(160).nullable(),
  summary: z.string().min(1).max(400).nullable(),
  source: z.enum(['user', 'system']),
  createdAt: isoDate,
  updatedAt: isoDate,
})

export const conflictEvidenceItemSchema = z.object({
  kind: z.string().min(1).max(64),
  label: z.string().min(1).max(280),
  leftPath: z.string().min(1).max(4096).optional(),
  rightPath: z.string().min(1).max(4096).optional(),
})

export const conflictFindingSchema = z.object({
  id: z.string().min(1),
  identityKey: z.string().min(1).max(256),
  repositoryId: z.string().min(1),
  leftSessionId: nullableText,
  rightSessionId: nullableText,
  leftWorktreePath: nullablePath,
  rightWorktreePath: nullablePath,
  leftSource: z.enum(observerSourceIds).nullable(),
  rightSource: z.enum(observerSourceIds).nullable(),
  leftAttributionConfidence: z
    .enum(attributionConfidences)
    .optional()
    .default('unknown'),
  rightAttributionConfidence: z
    .enum(attributionConfidences)
    .optional()
    .default('unknown'),
  level: z.enum(conflictLevels),
  score: z.number().int().min(0).max(100),
  confidence: z.enum(attributionConfidences),
  headline: z.string().min(1).max(80),
  summary: z.string().min(1).max(280),
  recommendation: z.string().min(1).max(400),
  reasons: z.array(z.string().min(1).max(280)).max(OBSERVER_MAX_CONFLICT_REASONS),
  evidence: z.array(conflictEvidenceItemSchema).max(OBSERVER_MAX_CONFLICT_EVIDENCE),
  fingerprint: z.string().min(1).max(128),
  status: z.enum(conflictFindingStatuses),
  detectedAt: isoDate,
  updatedAt: isoDate,
  resolvedAt: isoDate.nullable(),
})

export const listConflictsQuerySchema = z
  .object({
    repositoryId: z.string().min(1).max(128).optional(),
    source: z.enum(observerSourceIds).optional(),
    level: z.enum(conflictLevels).optional(),
    status: z.enum(conflictFindingStatuses).optional(),
    unconfirmed: z
      .enum(['1', 'true', 'yes', 'open', 'unconfirmed'])
      .optional(),
    mode: z.enum(['simple', 'detail']).optional(),
  })
  .strict()

export const conflictMutationBodySchema = z.object({}).strict()

export const conflictIdParamSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'conflict id is invalid')

export const observerInstallFilePlanSchema = z.object({
  path: pathText,
  action: z.enum(['create', 'update', 'remove', 'keep']),
  preview: z.string().max(20_000),
  previous: z.string().max(20_000).optional(),
})

export const observerInstallResultSchema = z.object({
  ok: z.boolean(),
  changed: z.boolean(),
  message: z.string().min(1).max(500),
  preview: z.string().max(20_000).optional(),
  requiresConfirm: z.boolean().optional(),
  applied: z.boolean().optional(),
  files: z.array(observerInstallFilePlanSchema).max(20).optional(),
  evidence: z.array(z.string().max(280)).max(20).optional(),
  confirmationToken: z.string().min(1).max(128).optional(),
  planDigest: z.string().min(1).max(128).optional(),
  targetRoot: pathText.optional(),
})

export const observerAdapterActionRequestSchema = z
  .object({
    confirm: z.boolean().optional(),
    scope: z.enum(['user', 'repo']).optional(),
    repositoryId: z.string().min(1).max(128).optional(),
    confirmationToken: z.string().min(1).max(128).optional(),
    planDigest: z.string().min(1).max(128).optional(),
    homeDir: z.unknown().optional(),
    repoDir: z.unknown().optional(),
    allowRealUserApply: z.unknown().optional(),
    env: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.homeDir !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'homeDir は指定できません',
        path: ['homeDir'],
      })
    }
    if (value.repoDir !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'repoDir は指定できません',
        path: ['repoDir'],
      })
    }
    if (value.allowRealUserApply !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'allowRealUserApply は指定できません',
        path: ['allowRealUserApply'],
      })
    }
    if (value.env !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'env は指定できません',
        path: ['env'],
      })
    }
  })

export const updateSessionLabelRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(160).nullable().optional(),
    summary: z.string().trim().min(1).max(400).nullable().optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.summary !== undefined,
    { message: 'label update requires title or summary' },
  )

export type InboundObserverEvent = z.infer<typeof inboundObserverEventSchema>
export type InboundObserverBatch = z.infer<typeof inboundObserverBatchSchema>
export type UpdateSessionLabelRequest = z.infer<
  typeof updateSessionLabelRequestSchema
>
export type ObserverAdapterActionRequest = z.infer<
  typeof observerAdapterActionRequestSchema
>

export const observedWorkSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  source: z.enum(observerSourceIds),
  surface: z.enum(observerSurfaces),
  displayName: shortText,
  repositoryId: nullableText,
  workspaceId: nullableText,
  title: z.string().min(1).max(160).nullable(),
  activity: z.enum(observerActivities),
  status: z.enum(externalSessionStatuses),
  attributionConfidence: z.enum(attributionConfidences),
  claimedPaths: z.array(pathText).max(OBSERVER_UI_MAX_FILES),
  lastObservedAt: isoDate,
  startedAt: isoDate,
})

export const attentionItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(attentionKinds),
  severity: z.enum(attentionSeverities),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(280),
  repositoryId: nullableText,
  source: z.enum(observerSourceIds).nullable(),
  workIds: z.array(z.string().min(1)).max(OBSERVER_UI_MAX_SESSIONS),
  conflictId: nullableText,
  evidence: z.array(z.string().min(1).max(280)).max(OBSERVER_MAX_CONFLICT_EVIDENCE),
  attributionConfidence: z.enum(attributionConfidences),
  occurredAt: isoDate,
})

export const recommendationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(280),
})

export const repositorySituationSchema = z.object({
  repositoryId: z.string().min(1),
  displayName: shortText,
  available: z.boolean(),
  works: z.array(observedWorkSchema).max(OBSERVER_UI_MAX_SESSIONS),
  attention: z.array(attentionItemSchema).max(OBSERVER_UI_MAX_CONFLICTS),
  waitingCount: z.number().int().min(0),
  staleCount: z.number().int().min(0),
  conflictCount: z.number().int().min(0),
})

export const observerHealthSnapshotSchema = z.object({
  ok: z.boolean(),
  degradedCount: z.number().int().min(0),
  adapters: z
    .array(
      z.object({
        source: z.enum(observerSourceIds),
        status: z.enum(adapterInstallationStatuses),
        lastEventAt: isoDate.nullable(),
      }),
    )
    .max(20),
})

export const controlPlaneSnapshotSchema = z.object({
  generatedAt: isoDate,
  works: z.array(observedWorkSchema).max(OBSERVER_UI_MAX_SESSIONS),
  attention: z.array(attentionItemSchema).max(OBSERVER_UI_MAX_CONFLICTS),
  recommendations: z.array(recommendationSchema).max(20),
  repositories: z.array(repositorySituationSchema).max(OBSERVER_UI_MAX_REPOSITORIES),
  observer: observerHealthSnapshotSchema,
})
