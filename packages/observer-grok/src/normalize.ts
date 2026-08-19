import {
  buildIdempotencyKey,
  classifyCommandCategory,
  createObserverEventId,
  extractToolFilePaths,
  nowIso,
  normalizeObserverDateTime,
  OBSERVER_SCHEMA_VERSION,
  pickAllowlistedPayload,
  sanitizeObservedPath,
  toolActionForName,
  type NormalizedObserverEvent,
  type ObserverActorKind,
  type ObserverResource,
  type ObserverSurface,
} from '@sikumi-local/observer-core'
import {
  canonicalizeGrokEventName,
  isGrokHookEvent,
  mapGrokEvent,
} from './events.js'
import {
  isDroppedGrokStreamEvent,
  normalizeGrokStreamEvent,
} from './stream.js'

export function normalizeGrokEvent(
  input: unknown,
): NormalizedObserverEvent | null {
  try {
    if (isDroppedGrokStreamEvent(input)) {
      return null
    }
    if (isStreamShaped(input)) {
      return normalizeGrokStreamEvent(input)
    }
    const hook = normalizeGrokHookOrNull(input)
    if (hook) {
      return hook
    }
    return normalizeGrokStreamEvent(input)
  } catch {
    return null
  }
}

function isStreamShaped(input: unknown): boolean {
  return (
    isPlainObject(input) &&
    typeof input.type === 'string' &&
    typeof input.hook_event_name !== 'string'
  )
}

function normalizeGrokHookOrNull(
  input: unknown,
): NormalizedObserverEvent | null {
  if (!isPlainObject(input)) {
    return null
  }
  const nativeRaw =
    readString(input.hook_event_name) ??
    readString(input.nativeEventType) ??
    readString(input.event)
  if (!nativeRaw && !looksLikeHook(input)) {
    return null
  }
  const nativeEventType = canonicalizeGrokEventName(nativeRaw ?? 'unknown')
  const receivedAt = nowIso()
  const occurredAt =
    normalizeObserverDateTime(
      readString(input.occurredAt) ??
        readString(input.timestamp) ??
        receivedAt,
    ) ?? receivedAt
  const sessionId =
    readString(input.session_id) ?? readString(input.sessionId) ?? null
  const toolName =
    readString(input.tool_name) ??
    readString(input.toolName) ??
    readNested(input.tool, 'name')
  const mapped = mapGrokEvent(nativeEventType, toolName)
  const toolInput = input.tool_input ?? input.toolInput ?? input.input
  const filePaths = extractToolFilePaths({ toolName, toolInput })
  const filePath =
    filePaths[0] ??
    readString(input.file_path) ??
    readString(input.path) ??
    null
  const safeFilePath = filePath ? sanitizeObservedPath(filePath) : null
  const commandCategory = isPlainObject(toolInput)
    ? classifyCommandCategory(toolInput.command)
    : classifyCommandCategory(input.command)
  const toolUseId =
    readString(input.tool_use_id) ??
    readString(input.toolUseId) ??
    readNested(input.tool, 'id')
  const cwd = readString(input.cwd)
  const resource = inferResource(
    mapped.normalizedType,
    safeFilePath,
    toolName,
    nativeEventType,
  )
  const payload = pickAllowlistedPayload({
    nativeEventType,
    ...(toolName ? { toolName } : {}),
    ...(safeFilePath ? { filePath: safeFilePath } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    ...(commandCategory !== 'unknown' ? { commandCategory } : {}),
    ...(readString(input.model) ? { model: readString(input.model) } : {}),
  })

  return {
    id: createObserverEventId(),
    schemaVersion: OBSERVER_SCHEMA_VERSION,
    occurredAt,
    receivedAt,
    source: 'grok-build',
    surface: inferSurface(input),
    nativeEventType: isGrokHookEvent(nativeEventType)
      ? nativeEventType
      : nativeEventType.slice(0, 512) || 'unknown',
    normalizedType: mapped.normalizedType,
    externalSessionId: sessionId,
    externalTurnId: readString(input.turn_id) ?? readString(input.turnId),
    externalTaskId: readString(input.task_id) ?? readString(input.taskId),
    externalSubagentId:
      readString(input.subagent_id) ??
      readString(input.subagentId) ??
      readString(input.agent_id),
    cwd,
    repositoryId: null,
    worktreePath:
      readString(input.worktree_path) ??
      readString(input.worktreePath) ??
      cwd,
    branch: readString(input.branch),
    baseCommit: null,
    headCommit: null,
    actorKind: inferActor(nativeEventType),
    activity: mapped.activity,
    resource,
    summary: summarize(nativeEventType, toolName, safeFilePath),
    attributionConfidence: 'verified',
    ingestionMethod: 'hook',
    idempotencyKey: buildIdempotencyKey({
      source: 'grok-build',
      externalSessionId: sessionId,
      nativeEventType,
      toolUseId,
      occurredAt,
      resourcePath: resource?.key ?? safeFilePath,
    }),
    payload,
  }
}

function looksLikeHook(input: Record<string, unknown>): boolean {
  return (
    typeof input.hook_event_name === 'string' ||
    typeof input.tool_name === 'string' ||
    typeof input.session_id === 'string'
  )
}

function inferSurface(input: Record<string, unknown>): ObserverSurface {
  const hint = [
    readString(input.surface),
    readString(input.client),
    readString(input.app),
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase()
  if (hint.includes('desktop') || hint.includes('app')) {
    return 'desktop-app'
  }
  if (hint.includes('cli') || hint.includes('headless') || hint.includes('terminal')) {
    return 'cli'
  }
  if (hint.includes('ide')) {
    return 'ide'
  }
  return 'unknown'
}

function inferActor(nativeEventType: string): ObserverActorKind {
  if (nativeEventType.startsWith('Subagent')) {
    return 'subagent'
  }
  if (nativeEventType === 'UserPromptSubmit') {
    return 'human'
  }
  return 'agent'
}

function inferResource(
  type: NormalizedObserverEvent['normalizedType'],
  filePath: string | null,
  toolName: string | null,
  nativeEventType: string,
): ObserverResource | null {
  if (nativeEventType === 'WorktreeCreate') {
    return { type: 'worktree', key: filePath ?? 'worktree', action: 'create' }
  }
  if (nativeEventType === 'WorktreeRemove') {
    return { type: 'worktree', key: filePath ?? 'worktree', action: 'delete' }
  }
  const action = toolActionForName(toolName)
  if (action === 'execute') {
    return { type: 'command', key: 'command', action: 'execute' }
  }
  if (filePath) {
    return {
      type: 'file',
      key: filePath,
      action: action === 'read' || type === 'file.read' ? 'read' : 'write',
    }
  }
  return null
}

function summarize(
  nativeEventType: string,
  toolName: string | null,
  filePath: string | null,
): string | null {
  if (nativeEventType === 'SessionStart') {
    return 'Grok Buildの作業が始まりました'
  }
  if (nativeEventType === 'SessionEnd') {
    return 'Grok Buildの作業が終わりました'
  }
  if (nativeEventType === 'PermissionRequest') {
    return 'Grok Buildが確認を待っています'
  }
  if (nativeEventType === 'SubagentStart') {
    return 'Grok Buildのサブエージェントが始まりました'
  }
  if (filePath) {
    return 'Grok Buildがファイルを扱っています'
  }
  if (toolName) {
    return 'Grok Buildが道具を使っています'
  }
  return 'Grok Buildの様子が届きました'
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readNested(value: unknown, key: string): string | null {
  return isPlainObject(value) ? readString(value[key]) : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
