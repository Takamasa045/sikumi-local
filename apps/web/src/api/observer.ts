import { z } from 'zod'
import { authorizedHeaders, toApiError, writeWithCsrfRetry } from './session'

const sessionViewSchema = z.object({
  id: z.string(),
  source: z.string(),
  surface: z.string().optional(),
  displayName: z.string(),
  status: z.string(),
  activity: z.string(),
  attributionConfidence: z.string(),
  title: z.string(),
  goal: z.string().nullable().optional(),
  lastObservedAt: z.string(),
  lastObservedLabel: z.string().nullable(),
})

const worktreeViewSchema = z.object({
  path: z.string(),
  isPrimary: z.boolean(),
  branch: z.string().nullable(),
  changedFileCount: z.number(),
  returnedFileCount: z.number().optional(),
  filesTruncated: z.boolean().optional(),
  files: z.array(
    z.object({
      path: z.string(),
      changeLabel: z.string(),
      areaLabel: z.string(),
      addedLines: z.number().nullable(),
      deletedLines: z.number().nullable(),
    }),
  ),
})

const conflictEvidenceSchema = z.object({
  kind: z.string(),
  label: z.string(),
  leftPath: z.string().optional(),
  rightPath: z.string().optional(),
})

const conflictSchema = z.object({
  id: z.string(),
  identityKey: z.string().optional(),
  repositoryId: z.string().optional(),
  repositoryDisplayName: z.string().optional(),
  leftSource: z.string().nullable().optional(),
  rightSource: z.string().nullable().optional(),
  leftAttributionConfidence: z.string().optional(),
  rightAttributionConfidence: z.string().optional(),
  leftActorLabel: z.string().optional(),
  rightActorLabel: z.string().optional(),
  level: z.string(),
  score: z.number(),
  confidence: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string(),
  recommendation: z.string().optional(),
  reasons: z.array(z.string()).optional(),
  evidence: z.array(conflictEvidenceSchema).optional(),
  status: z.string(),
  technical: z
    .object({
      leftBranch: z.string().nullable().optional(),
      rightBranch: z.string().nullable().optional(),
      leftWorktreePath: z.string().nullable().optional(),
      rightWorktreePath: z.string().nullable().optional(),
      leftHead: z.string().nullable().optional(),
      rightHead: z.string().nullable().optional(),
      commonBase: z.string().nullable().optional(),
      changedPaths: z.array(z.string()).optional(),
    })
    .optional(),
})

export const repositoryActivitySchema = z.object({
  repositoryId: z.string(),
  workspaceId: z.string(),
  displayName: z.string(),
  available: z.boolean(),
  gitAvailable: z.boolean(),
  summary: z.string(),
  changedFileCount: z.number(),
  lastChangedAt: z.string().nullable().optional(),
  lastChangedLabel: z.string().nullable(),
  latestRecordTitle: z.string().nullable().optional(),
  workStory: z.string().nullable().optional(),
  placeIntro: z.string().nullable().optional(),
  articleTitles: z
    .array(
      z.object({
        title: z.string(),
        date: z.string().nullable().optional(),
      }),
    )
    .optional(),
  workTitles: z.array(z.string()).optional(),
  outgoingCount: z.number().nullable().optional(),
  incomingCount: z.number().nullable().optional(),
  sessions: z.array(sessionViewSchema),
  worktrees: z.array(worktreeViewSchema),
  conflicts: z.array(conflictSchema),
  areas: z.array(z.string()),
  truncated: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
})

export const todayOverviewSchema = z.object({
  generatedAt: z.string(),
  repositoryCount: z.number(),
  activeRepositoryCount: z.number(),
  waitingCount: z.number(),
  conflictCount: z.number(),
  repositories: z.array(repositoryActivitySchema),
  truncated: z.boolean().optional(),
})

export type TodayOverview = z.infer<typeof todayOverviewSchema>
export type RepositoryActivity = z.infer<typeof repositoryActivitySchema>
export type ConflictView = z.infer<typeof conflictSchema>
export type ConflictCounts = {
  readonly red: number
  readonly orange: number
  readonly yellow: number
}

export interface ConflictListFilters {
  readonly repositoryId?: string
  readonly source?: string
  readonly level?: string
  readonly unconfirmed?: boolean
  readonly mode?: 'simple' | 'detail'
}

const adapterSchema = z.object({
  id: z.string(),
  source: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  installationStatus: z.string(),
  lastEventAt: z.string().nullable(),
  health: z
    .object({
      ok: z.boolean(),
      status: z.string(),
      warnings: z.array(z.string()),
      errors: z.array(z.string()),
    })
    .optional(),
})

const installResultSchema = z.object({
  ok: z.boolean(),
  changed: z.boolean(),
  message: z.string(),
  preview: z.string().optional(),
  requiresConfirm: z.boolean().optional(),
  applied: z.boolean().optional(),
  evidence: z.array(z.string()).optional(),
  confirmationToken: z.string().optional(),
  planDigest: z.string().optional(),
  targetRoot: z.string().optional(),
})

export type ObserverAdapterView = z.infer<typeof adapterSchema>
export type ObserverInstallView = z.infer<typeof installResultSchema>

const observedWorkSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  source: z.string(),
  surface: z.string(),
  displayName: z.string(),
  repositoryId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  title: z.string().nullable(),
  activity: z.string(),
  status: z.string(),
  attributionConfidence: z.string(),
  claimedPaths: z.array(z.string()),
  lastObservedAt: z.string(),
  startedAt: z.string(),
})

const attentionItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  severity: z.string(),
  title: z.string(),
  summary: z.string(),
  repositoryId: z.string().nullable(),
  source: z.string().nullable(),
  workIds: z.array(z.string()),
  conflictId: z.string().nullable(),
  evidence: z.array(z.string()),
  attributionConfidence: z.string(),
  occurredAt: z.string(),
})

export const controlPlaneSnapshotSchema = z.object({
  generatedAt: z.string(),
  works: z.array(observedWorkSchema),
  attention: z.array(attentionItemSchema),
  recommendations: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
    }),
  ),
  repositories: z.array(
    z.object({
      repositoryId: z.string(),
      displayName: z.string(),
      available: z.boolean(),
      works: z.array(observedWorkSchema),
      attention: z.array(attentionItemSchema),
      waitingCount: z.number(),
      staleCount: z.number(),
      conflictCount: z.number(),
    }),
  ),
  observer: z.object({
    ok: z.boolean(),
    degradedCount: z.number(),
    adapters: z.array(
      z.object({
        source: z.string(),
        status: z.string(),
        lastEventAt: z.string().nullable(),
      }),
    ),
  }),
})

export type ControlPlaneSnapshot = z.infer<typeof controlPlaneSnapshotSchema>

export async function getControlPlaneSnapshot(): Promise<ControlPlaneSnapshot> {
  const response = await fetch('/api/observer/control-plane', {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ snapshot: controlPlaneSnapshotSchema }).parse(body).snapshot
}

export async function acknowledgeAttention(id: string) {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/observer/attention/${encodeURIComponent(id)}/acknowledge`, {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({}),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ attention: attentionItemSchema }).parse(body).attention
}

const externalSessionDetailSchema = z.object({
  id: z.string(),
  branch: z.string().nullable().optional(),
  worktreePath: z.string().nullable().optional(),
  headCommit: z.string().nullable().optional(),
})

export async function getExternalSessionDetail(id: string): Promise<{
  readonly branch: string | null
  readonly worktreePath: string | null
  readonly commit: string | null
}> {
  const response = await fetch(`/api/external-sessions/${id}`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  const session = z
    .object({ session: externalSessionDetailSchema })
    .parse(body).session
  return {
    branch: session.branch ?? null,
    worktreePath: session.worktreePath ?? null,
    commit: session.headCommit ?? null,
  }
}

export async function getTodayOverview(): Promise<TodayOverview> {
  const response = await fetch('/api/observer/today', {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ overview: todayOverviewSchema }).parse(body).overview
}

export async function getRepositoryActivity(
  id: string,
): Promise<RepositoryActivity> {
  const response = await fetch(`/api/repositories/${id}/activity`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ activity: repositoryActivitySchema }).parse(body).activity
}

export async function rescanRepository(
  id: string,
): Promise<RepositoryActivity> {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/repositories/${id}/rescan`, {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ activity: repositoryActivitySchema }).parse(body).activity
}

export async function listObserverAdapters() {
  const response = await fetch('/api/observer/adapters', {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ adapters: z.array(adapterSchema) }).parse(body).adapters
}

export async function checkObserverAdapter(source: string) {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/observer/adapters/${source}/check`, {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ adapter: adapterSchema }).parse(body).adapter
}

export type ObserverAdapterActionInput = {
  readonly scope?: 'user' | 'repo'
  readonly repositoryId?: string
  readonly confirmationToken?: string
  readonly planDigest?: string
}

export async function previewObserverAdapterAction(
  source: string,
  action: 'install' | 'uninstall',
  input: ObserverAdapterActionInput = {},
) {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/observer/adapters/${source}/${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...authorizedHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        confirm: false,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.repositoryId === undefined
          ? {}
          : { repositoryId: input.repositoryId }),
      }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ result: installResultSchema }).parse(body).result
}

export async function listConflicts(filters: ConflictListFilters = {}) {
  const params = new URLSearchParams()
  if (filters.repositoryId) {
    params.set('repositoryId', filters.repositoryId)
  }
  if (filters.source) {
    params.set('source', filters.source)
  }
  if (filters.level) {
    params.set('level', filters.level)
  }
  if (filters.unconfirmed) {
    params.set('unconfirmed', 'true')
  }
  if (filters.mode) {
    params.set('mode', filters.mode)
  }
  const query = params.toString()
  const response = await fetch(`/api/conflicts${query ? `?${query}` : ''}`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z
    .object({
      conflicts: z.array(conflictSchema),
      counts: z
        .object({
          red: z.number(),
          orange: z.number(),
          yellow: z.number(),
        })
        .optional(),
    })
    .parse(body)
}

export async function getConflict(
  id: string,
  mode: 'simple' | 'detail' = 'simple',
) {
  const response = await fetch(`/api/conflicts/${id}?mode=${mode}`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ conflict: conflictSchema }).parse(body).conflict
}

export async function acknowledgeConflict(id: string) {
  return mutateConflict(id, 'acknowledge')
}

export async function resolveConflict(id: string) {
  return mutateConflict(id, 'resolve')
}

export async function recheckConflict(id: string) {
  return mutateConflict(id, 'recheck')
}

async function mutateConflict(
  id: string,
  action: 'acknowledge' | 'resolve' | 'recheck',
) {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/conflicts/${id}/${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({}),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ conflict: conflictSchema }).parse(body).conflict
}

export async function runObserverAdapterAction(
  source: string,
  action: 'install' | 'uninstall',
  input: ObserverAdapterActionInput = {},
) {
  const preview = await previewObserverAdapterAction(source, action, input)
  if (!preview.ok || preview.requiresConfirm !== true) {
    return preview
  }
  return applyObserverAdapterAction(source, action, {
    ...input,
    ...(preview.confirmationToken
      ? { confirmationToken: preview.confirmationToken }
      : {}),
    ...(preview.planDigest ? { planDigest: preview.planDigest } : {}),
  })
}

export async function applyObserverAdapterAction(
  source: string,
  action: 'install' | 'uninstall',
  input: ObserverAdapterActionInput,
) {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/observer/adapters/${source}/${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...authorizedHeaders(token),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        confirm: true,
        confirmationToken: input.confirmationToken,
        planDigest: input.planDigest,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.repositoryId === undefined
          ? {}
          : { repositoryId: input.repositoryId }),
      }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ result: installResultSchema }).parse(body).result
}
