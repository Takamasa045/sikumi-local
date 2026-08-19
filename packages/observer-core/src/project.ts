import { AppError } from '@sikumi-local/core'
import { normalizeObserverDateTime } from './datetime.js'
import {
  buildIdempotencyKey,
  createObserverEventId,
  nowIso,
} from './idempotency.js'
import { toRepoRelativePath } from './paths.js'
import {
  classifyCommandCategory,
  extractToolFilePaths,
  toolActionForName,
} from './hook-tools.js'
import {
  extractAllowlistedFields,
  pickAllowlistedPayload,
  sanitizeObserverSummary,
} from './redaction.js'
import { inboundObserverEventSchema } from './schemas.js'
import {
  isObserverNormalizedType,
  isObserverSourceId,
  OBSERVER_SCHEMA_VERSION,
  observerSurfaces,
  type IngestionMethod,
  type NormalizedObserverEvent,
  type ObserverActivity,
  type ObserverNormalizedType,
  type ObserverResource,
  type ObserverSourceId,
  type ObserverSurface,
} from './types.js'

export function projectInboundEvent(
  raw: unknown,
  options?: {
    readonly source?: ObserverSourceId
    readonly receivedAt?: string
    readonly ingestionMethod?: IngestionMethod
  },
): NormalizedObserverEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError(
      'OBSERVER_EVENT_INVALID',
      'Observer event must be an object',
      400,
    )
  }

  const record = raw as Record<string, unknown>
  const parsed = inboundObserverEventSchema.safeParse({
    ...record,
    ...(options?.source ? { source: options.source } : {}),
  })
  if (!parsed.success) {
    throw new AppError(
      'OBSERVER_EVENT_INVALID',
      'Observer event is invalid',
      400,
    )
  }

  const inbound = parsed.data
  const source = inbound.source
  if (!isObserverSourceId(source)) {
    throw new AppError('OBSERVER_EVENT_INVALID', 'Unknown observer source', 400)
  }

  const nativeEventType =
    inbound.nativeEventType ??
    readString(record.type) ??
    readString(record.hook_event_name) ??
    readString(record.event) ??
    'unknown'
  const normalizedType =
    inbound.normalizedType ?? inferNormalizedType(nativeEventType)
  const receivedAt =
    normalizeObserverDateTime(options?.receivedAt ?? nowIso()) ?? nowIso()
  const rawOccurredAt = inbound.occurredAt ?? readString(record.timestamp)
  if (rawOccurredAt && !normalizeObserverDateTime(rawOccurredAt)) {
    throw new AppError(
      'OBSERVER_EVENT_INVALID',
      'Observer event timestamp is invalid',
      400,
    )
  }
  const occurredAt =
    normalizeObserverDateTime(rawOccurredAt ?? receivedAt) ?? receivedAt
  const externalSessionId =
    inbound.externalSessionId ??
    readString(record.session_id) ??
    readString(record.sessionId) ??
    null
  const cwd = inbound.cwd ?? readString(record.cwd) ?? null
  const extracted = extractAllowlistedFields(record)
  const toolName =
    readString(extracted.toolName) ??
    readString(record.tool_name) ??
    readString(record.toolName)
  const toolInput = record.tool_input ?? record.toolInput ?? record.input
  const extractedPaths = extractToolFilePaths({
    toolName,
    toolInput,
  })
  const filePath = readString(extracted.filePath) ?? extractedPaths[0] ?? null
  const commandCategory =
    readString(extracted.commandCategory) ??
    (isPlainObject(toolInput)
      ? classifyCommandCategory(toolInput.command)
      : classifyCommandCategory(record.command))
  const resource =
    inbound.resource ??
    inferResource(
      normalizedType,
      filePath,
      toolActionForName(toolName) === 'execute' ? 'command' : null,
    )
  const payload = pickAllowlistedPayload({
    ...extracted,
    ...(inbound.payload ?? {}),
    nativeEventType,
    ...(toolName ? { toolName } : {}),
    ...(filePath ? { filePath } : {}),
    ...(commandCategory !== 'unknown' ? { commandCategory } : {}),
    ...(readString(record.permission_mode) || readString(record.permissionMode)
      ? {
          permissionMode:
            readString(record.permission_mode) ??
            readString(record.permissionMode),
        }
      : {}),
    ...(readString(record.model) ? { model: readString(record.model) } : {}),
  })
  const toolUseId = payload.toolUseId ?? null
  const idempotencyKey =
    inbound.idempotencyKey ??
    buildIdempotencyKey({
      source,
      externalSessionId,
      nativeEventType,
      toolUseId,
      occurredAt,
      resourcePath: resource?.key ?? filePath,
    })

  return {
    id: inbound.id ?? createObserverEventId(),
    schemaVersion: OBSERVER_SCHEMA_VERSION,
    occurredAt,
    receivedAt,
    source,
    surface: inbound.surface ?? inferSurface(record),
    nativeEventType,
    normalizedType,
    externalSessionId,
    externalTurnId:
      inbound.externalTurnId ??
      readString(record.turn_id) ??
      readString(record.turnId) ??
      null,
    externalTaskId:
      inbound.externalTaskId ??
      readString(record.task_id) ??
      readString(record.taskId) ??
      null,
    externalSubagentId:
      inbound.externalSubagentId ??
      readString(record.subagent_id) ??
      readString(record.subagentId) ??
      null,
    cwd,
    repositoryId: inbound.repositoryId ?? null,
    worktreePath: inbound.worktreePath ?? null,
    branch: inbound.branch ?? readString(record.branch) ?? null,
    baseCommit: inbound.baseCommit ?? null,
    headCommit: inbound.headCommit ?? null,
    actorKind: inbound.actorKind ?? inferActor(normalizedType),
    activity: inbound.activity ?? inferActivity(normalizedType),
    resource,
    summary: sanitizeObserverSummary(inbound.summary ?? record.summary),
    attributionConfidence:
      inbound.attributionConfidence ??
      (source === 'git'
        ? 'inferred'
        : source === 'claude-desktop'
          ? 'reported'
          : 'verified'),
    ingestionMethod:
      inbound.ingestionMethod ??
      options?.ingestionMethod ??
      inferIngestion(source),
    idempotencyKey,
    payload,
  }
}

export function inferNormalizedType(
  nativeEventType: string,
): ObserverNormalizedType {
  const value = nativeEventType.toLowerCase()
  if (isObserverNormalizedType(nativeEventType)) {
    return nativeEventType
  }
  if (value.includes('sessionstart') || value === 'session.start') {
    return 'session.started'
  }
  if (value.includes('sessionend') || value === 'session.end') {
    return 'session.ended'
  }
  if (value.includes('fail')) {
    return 'session.failed'
  }
  if (value.includes('prompt')) {
    return 'prompt.submitted'
  }
  if (
    value.includes('readfile') ||
    value.includes('fileread') ||
    value.endsWith('.read')
  ) {
    return 'file.read'
  }
  if (value.includes('file') || value.includes('edit')) {
    return 'file.changed'
  }
  if (value.includes('shell') || value.includes('command')) {
    return value.includes('after') || value.includes('complete')
      ? 'command.completed'
      : 'command.started'
  }
  if (value.includes('permission')) {
    return value.includes('denied') || value.includes('resolv')
      ? 'permission.resolved'
      : 'permission.requested'
  }
  if (value.includes('subagentstart')) {
    return 'subagent.started'
  }
  if (value.includes('subagentstop') || value.includes('subagentend')) {
    return 'subagent.stopped'
  }
  if (value.includes('taskcreated') || value === 'task.created') {
    return 'task.created'
  }
  if (value.includes('taskcompleted') || value === 'task.completed') {
    return 'task.completed'
  }
  if (value.includes('worktreecreate')) {
    return 'worktree.created'
  }
  if (value.includes('worktreeremove')) {
    return 'worktree.removed'
  }
  if (value.includes('stop') || value.includes('notification')) {
    return 'user.input_required'
  }
  if (value.includes('heartbeat')) {
    return 'heartbeat'
  }
  return 'activity.changed'
}

function inferResource(
  type: ObserverNormalizedType,
  filePath: string | null,
  forcedType: ObserverResource['type'] | null = null,
): ObserverResource | null {
  if (!filePath) {
    if (forcedType === 'command' || type.startsWith('command.')) {
      return { type: 'command', key: 'command', action: 'execute' }
    }
    if (type.startsWith('worktree.')) {
      return {
        type: 'worktree',
        key: type,
        action: type.endsWith('removed') ? 'delete' : 'create',
      }
    }
    return null
  }
  const key = toRepoRelativePath(filePath)
  if (type === 'file.read') {
    return { type: 'file', key, action: 'read' }
  }
  if (type === 'file.changed') {
    return { type: 'file', key, action: 'write' }
  }
  return { type: 'file', key, action: 'write' }
}

function inferActivity(type: ObserverNormalizedType): ObserverActivity {
  switch (type) {
    case 'session.started':
      return 'starting'
    case 'session.ended':
      return 'completed'
    case 'session.failed':
      return 'failed'
    case 'prompt.submitted':
      return 'planning'
    case 'file.read':
      return 'reading'
    case 'file.changed':
      return 'editing'
    case 'command.started':
    case 'command.completed':
      return 'running-command'
    case 'permission.requested':
    case 'user.input_required':
      return 'waiting-for-user'
    case 'task.completed':
      return 'completed'
    case 'heartbeat':
      return 'idle'
    default:
      return 'unknown'
  }
}

function inferActor(type: ObserverNormalizedType) {
  if (type.startsWith('subagent.')) {
    return 'subagent' as const
  }
  if (type === 'prompt.submitted' || type === 'permission.resolved') {
    return 'human' as const
  }
  if (
    type.startsWith('session.') ||
    type.startsWith('file.') ||
    type.startsWith('command.')
  ) {
    return 'agent' as const
  }
  return 'unknown' as const
}

function inferSurface(record: Record<string, unknown>): ObserverSurface {
  const explicit = readString(record.surface)
  if (explicit && (observerSurfaces as readonly string[]).includes(explicit)) {
    return explicit as ObserverSurface
  }
  const hint = (
    explicit ??
    readString(record.client) ??
    readString(record.app) ??
    ''
  ).toLowerCase()
  if (
    hint === 'cursor-tab' ||
    hint.includes('cursortab') ||
    hint.includes('tab-hook')
  ) {
    return 'cursor-tab'
  }
  if (hint === 'cursor-agent' || hint.includes('cursor-agent')) {
    return 'cursor-agent'
  }
  if (hint === 'cursor-cli' || hint.includes('cursor-cli')) {
    return 'cursor-cli'
  }
  if (hint.includes('desktop') || hint.includes('app')) {
    return 'desktop-app'
  }
  if (hint.includes('cli') || hint.includes('terminal')) {
    return 'cli'
  }
  if (
    hint.includes('ide') ||
    hint.includes('vscode') ||
    hint.includes('cursor')
  ) {
    return 'ide'
  }
  if (hint.includes('mcp')) {
    return 'mcp'
  }
  return 'unknown'
}

function inferIngestion(source: ObserverSourceId): IngestionMethod {
  if (source === 'git') {
    return 'git-scan'
  }
  if (source === 'claude-desktop') {
    return 'mcp'
  }
  return 'hook'
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value) === false
  )
}
