import {
  buildIdempotencyKey,
  createObserverEventId,
  nowIso,
  normalizeObserverDateTime,
  OBSERVER_SCHEMA_VERSION,
  pickAllowlistedPayload,
  sanitizeObserverSummary,
  type NormalizedObserverEvent,
  type ObserverActivity,
  type ObserverNormalizedType,
  type ObserverResource,
  type ResourceAction,
  type ResourceType,
  resourceActions,
  resourceTypes,
} from '@sikumi-local/observer-core'
import {
  CLAUDE_DESKTOP_ATTRIBUTION,
  CLAUDE_DESKTOP_INGESTION,
  CLAUDE_DESKTOP_SOURCE,
  CLAUDE_DESKTOP_SURFACE,
  isSikumiMcpToolName,
} from './events.js'

export function normalizeClaudeDesktopReport(
  input: unknown,
): NormalizedObserverEvent | null {
  try {
    return normalizeClaudeDesktopReportOrNull(input)
  } catch {
    return null
  }
}

function normalizeClaudeDesktopReportOrNull(
  input: unknown,
): NormalizedObserverEvent | null {
  if (!isPlainObject(input)) {
    return null
  }
  const nativeEventType =
    readString(input.nativeEventType) ??
    readString(input.type) ??
    readString(input.tool) ??
    ''
  if (!isSikumiMcpToolName(nativeEventType)) {
    return null
  }
  const receivedAt = nowIso()
  const occurredAt =
    normalizeObserverDateTime(
      readString(input.occurredAt) ?? readString(input.timestamp) ?? receivedAt,
    ) ?? receivedAt
  const sessionId =
    readString(input.sessionId) ?? readString(input.externalSessionId)
  const summary = sanitizeObserverSummary(input.summary)
  const mapped = mapToolEvent(nativeEventType, input)
  const payload = pickAllowlistedPayload({
    nativeEventType,
    ...(mapped.resource
      ? {
          resourceType: mapped.resource.type,
          resourceKey: mapped.resource.key,
          action: mapped.resource.action,
          filePath: mapped.resource.key,
        }
      : {}),
  })
  return {
    id: readString(input.id) ?? createObserverEventId(),
    schemaVersion: OBSERVER_SCHEMA_VERSION,
    occurredAt,
    receivedAt,
    source: CLAUDE_DESKTOP_SOURCE,
    surface: CLAUDE_DESKTOP_SURFACE,
    nativeEventType,
    normalizedType: mapped.normalizedType,
    externalSessionId: sessionId,
    externalTurnId: null,
    externalTaskId: null,
    externalSubagentId: null,
    cwd: readString(input.repositoryPath) ?? readString(input.cwd),
    repositoryId: readString(input.repositoryId),
    worktreePath: readString(input.worktreePath),
    branch: null,
    baseCommit: null,
    headCommit: null,
    actorKind: 'agent',
    activity: mapped.activity,
    resource: mapped.resource,
    summary,
    attributionConfidence: CLAUDE_DESKTOP_ATTRIBUTION,
    ingestionMethod: CLAUDE_DESKTOP_INGESTION,
    idempotencyKey:
      readString(input.idempotencyKey) ??
      buildIdempotencyKey({
        source: CLAUDE_DESKTOP_SOURCE,
        externalSessionId: sessionId,
        nativeEventType,
        occurredAt,
        resourcePath: mapped.resource?.key ?? null,
      }),
    payload,
  }
}

function mapToolEvent(
  tool: string,
  input: Record<string, unknown>,
): {
  readonly normalizedType: ObserverNormalizedType
  readonly activity: ObserverActivity
  readonly resource: ObserverResource | null
} {
  switch (tool) {
    case 'sikumi.begin_work':
      return {
        normalizedType: 'session.started',
        activity: 'starting',
        resource: null,
      }
    case 'sikumi.update_work':
      return {
        normalizedType: 'activity.changed',
        activity: readActivity(input.activity) ?? 'planning',
        resource: null,
      }
    case 'sikumi.note_resource':
      return {
        normalizedType:
          readAction(input.action) === 'read' ? 'file.read' : 'file.changed',
        activity: readAction(input.action) === 'read' ? 'reading' : 'editing',
        resource: readResource(input),
      }
    case 'sikumi.waiting_for_user':
      return {
        normalizedType: 'user.input_required',
        activity: 'waiting-for-user',
        resource: null,
      }
    case 'sikumi.complete_work':
      return {
        normalizedType: 'session.ended',
        activity: 'completed',
        resource: null,
      }
    case 'sikumi.fail_work':
      return {
        normalizedType: 'session.failed',
        activity: 'failed',
        resource: null,
      }
    default:
      return {
        normalizedType: 'heartbeat',
        activity: 'unknown',
        resource: null,
      }
  }
}

function readResource(input: Record<string, unknown>): ObserverResource | null {
  const type = readString(input.resourceType)
  const key = readString(input.resourceKey)
  const action = readAction(input.action)
  if (!type || !key || !action || !isResourceType(type)) {
    return null
  }
  return { type, key, action }
}

function readActivity(value: unknown): ObserverActivity | null {
  if (typeof value !== 'string') {
    return null
  }
  const allowed: readonly ObserverActivity[] = [
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
  ]
  return allowed.includes(value as ObserverActivity)
    ? (value as ObserverActivity)
    : null
}

function readAction(value: unknown): ResourceAction | null {
  return typeof value === 'string' &&
    (resourceActions as readonly string[]).includes(value)
    ? (value as ResourceAction)
    : null
}

function isResourceType(value: string): value is ResourceType {
  return (resourceTypes as readonly string[]).includes(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
