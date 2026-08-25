import type {
  ConflictFinding,
  ExternalSession,
  NormalizedObserverEvent,
  ObserverAdapterRecord,
  ObserverSourceId,
  ResourceClaim,
} from '@sikumi-local/observer-core'

export const NOW_MS = Date.parse('2026-08-25T03:00:00.000Z')
export const NOW_ISO = '2026-08-25T03:00:00.000Z'
export const STALE_ISO = '2026-08-25T02:00:00.000Z'

export function session(input: {
  readonly id: string
  readonly source: ObserverSourceId
  readonly repositoryId?: string | null
  readonly status?: ExternalSession['status']
  readonly activity?: ExternalSession['activity']
  readonly attributionConfidence?: ExternalSession['attributionConfidence']
  readonly lastObservedAt?: string
  readonly title?: string | null
  readonly surface?: ExternalSession['surface']
  readonly externalSessionId?: string | null
  readonly worktreePath?: string | null
}): ExternalSession {
  return {
    id: input.id,
    source: input.source,
    surface: input.surface ?? 'cli',
    externalSessionId: input.externalSessionId ?? input.id,
    workspaceId: 'ws-a',
    repositoryId: input.repositoryId === undefined ? 'repo-a' : input.repositoryId,
    cwd: '/tmp/repo-a',
    worktreePath: input.worktreePath ?? '/tmp/repo-a',
    branch: 'main',
    baseCommit: null,
    headCommit: null,
    title: input.title === undefined ? 'ログイン画面の直し' : input.title,
    status: input.status ?? 'active',
    activity: input.activity ?? 'editing',
    attributionConfidence: input.attributionConfidence ?? 'verified',
    startedAt: '2026-08-25T02:50:00.000Z',
    lastObservedAt: input.lastObservedAt ?? NOW_ISO,
    endedAt: null,
  }
}

export function claim(
  sessionId: string,
  path: string,
  at = NOW_ISO,
): ResourceClaim {
  return {
    id: `${sessionId}:${path}`,
    externalSessionId: sessionId,
    repositoryId: 'repo-a',
    resourceType: 'file',
    resourceKey: path,
    action: 'write',
    claimKind: 'observed',
    confidence: 'verified',
    firstObservedAt: at,
    lastObservedAt: at,
  }
}

export function event(input: {
  readonly id: string
  readonly source: ObserverSourceId
  readonly repositoryId?: string | null
  readonly externalSessionId?: string | null
  readonly normalizedType?: NormalizedObserverEvent['normalizedType']
  readonly activity?: NormalizedObserverEvent['activity']
  readonly occurredAt?: string
  readonly summary?: string | null
}): NormalizedObserverEvent {
  return {
    id: input.id,
    schemaVersion: 1,
    occurredAt: input.occurredAt ?? NOW_ISO,
    receivedAt: input.occurredAt ?? NOW_ISO,
    source: input.source,
    surface: 'cli',
    nativeEventType: input.normalizedType ?? 'activity.changed',
    normalizedType: input.normalizedType ?? 'activity.changed',
    externalSessionId: input.externalSessionId ?? input.id,
    externalTurnId: null,
    externalTaskId: null,
    externalSubagentId: null,
    cwd: '/tmp/repo-a',
    repositoryId: input.repositoryId === undefined ? 'repo-a' : input.repositoryId,
    worktreePath: '/tmp/repo-a',
    branch: 'main',
    baseCommit: null,
    headCommit: null,
    actorKind: 'agent',
    activity: input.activity ?? 'editing',
    resource: null,
    summary: input.summary === undefined ? 'ログイン画面の直し' : input.summary,
    attributionConfidence: 'verified',
    ingestionMethod: 'hook',
    idempotencyKey: `idem-${input.id}`,
    payload: {},
  }
}

export function finding(input: {
  readonly id: string
  readonly level: ConflictFinding['level']
  readonly leftConfidence?: ConflictFinding['leftAttributionConfidence']
  readonly rightConfidence?: ConflictFinding['rightAttributionConfidence']
  readonly evidenceKind?: string
  readonly status?: ConflictFinding['status']
  readonly repositoryId?: string
  readonly leftSource?: ConflictFinding['leftSource']
  readonly rightSource?: ConflictFinding['rightSource']
  readonly leftSessionId?: string | null
  readonly rightSessionId?: string | null
}): ConflictFinding {
  return {
    id: input.id,
    identityKey: `identity-${input.id}`,
    repositoryId: input.repositoryId ?? 'repo-a',
    leftSessionId: input.leftSessionId === undefined ? 'codex-a' : input.leftSessionId,
    rightSessionId:
      input.rightSessionId === undefined ? 'cursor-a' : input.rightSessionId,
    leftWorktreePath: '/tmp/repo-a',
    rightWorktreePath: '/tmp/repo-a-wt',
    leftSource: input.leftSource === undefined ? 'codex' : input.leftSource,
    rightSource: input.rightSource === undefined ? 'cursor' : input.rightSource,
    leftAttributionConfidence: input.leftConfidence ?? 'verified',
    rightAttributionConfidence: input.rightConfidence ?? 'correlated',
    level: input.level,
    score: input.level === 'critical' ? 92 : input.level === 'high' ? 82 : 45,
    confidence: input.leftConfidence ?? 'verified',
    headline: '🔴 同じ仕組みを変更しています',
    summary: '同じファイルを書いています',
    recommendation: '先に一方を仕上げてください',
    reasons: ['同じファイルを書いています'],
    evidence: [
      {
        kind: input.evidenceKind ?? 'same-file',
        label: '同じファイルを書いています',
        leftPath: 'src/auth.ts',
        rightPath: 'src/auth.ts',
      },
    ],
    fingerprint: `fp-${input.id}`,
    status: input.status ?? 'open',
    detectedAt: NOW_ISO,
    updatedAt: NOW_ISO,
    resolvedAt: null,
  }
}

export function adapter(input: {
  readonly source: ObserverAdapterRecord['source']
  readonly status?: ObserverAdapterRecord['installationStatus']
  readonly errors?: readonly string[]
}): ObserverAdapterRecord {
  const status = input.status ?? 'ready'
  return {
    id: input.source,
    source: input.source,
    displayName: input.source,
    enabled: true,
    installationStatus: status,
    installedVersion: null,
    detectedVersion: '1.0.0',
    lastEventAt: NOW_ISO,
    health: {
      ok: status !== 'degraded' && (input.errors?.length ?? 0) === 0,
      status,
      detectedVersion: '1.0.0',
      supportedRange: null,
      lastEventAt: NOW_ISO,
      warnings: [],
      errors: input.errors ?? [],
    },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  }
}
