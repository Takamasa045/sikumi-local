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
} from '@sikumi-local/observer-core'
import { canonicalizeGrokEventName, mapGrokEvent } from './events.js'

const DROP_TYPES = new Set([
  'available_commands',
  'available_commands_update',
  'text',
  'thought',
  'thought_delta',
  'reasoning',
  'reasoning_delta',
  'streaming_text',
  'streaming_reasoning',
  'assistant',
  'message',
  'content',
  'delta',
  'agent_thought_chunk',
  'agent_message_chunk',
  'user_message_chunk',
  'response',
])

export function isDroppedGrokStreamEvent(input: unknown): boolean {
  if (!isPlainObject(input)) {
    return false
  }
  const type = streamType(input)
  if (!type) {
    return false
  }
  const value = type.toLowerCase()
  if (DROP_TYPES.has(value)) {
    return true
  }
  return (
    value.includes('available_command') ||
    value.includes('thought') ||
    value.includes('reasoning') ||
    value.includes('agent_message') ||
    value.includes('user_message') ||
    value === 'text' ||
    value.endsWith('_text')
  )
}

export function normalizeGrokStreamEvent(
  input: unknown,
): NormalizedObserverEvent | null {
  try {
    if (!isPlainObject(input) || isDroppedGrokStreamEvent(input)) {
      return null
    }
    const type = streamType(input)
    if (!type || !isAllowlistedStreamType(type)) {
      return null
    }
    return buildStreamEvent(input, type)
  } catch {
    return null
  }
}

function isAllowlistedStreamType(type: string): boolean {
  const value = type.toLowerCase()
  if (
    value.includes('available_command') ||
    value.includes('thought') ||
    value.includes('reasoning') ||
    value.includes('agent_message') ||
    value.includes('user_message')
  ) {
    return false
  }
  return (
    value.includes('session') ||
    value.includes('tool') ||
    value === 'result' ||
    value.endsWith('_result') ||
    value === 'end'
  )
}

function buildStreamEvent(
  input: Record<string, unknown>,
  type: string,
): NormalizedObserverEvent {
  const receivedAt = nowIso()
  const occurredAt =
    normalizeObserverDateTime(
      readString(input.occurredAt) ??
        readString(input.timestamp) ??
        receivedAt,
    ) ?? receivedAt
  const subtype = readString(input.subtype)
  const nativeEventType = canonicalizeGrokEventName(
    readString(input.hook_event_name) ??
      (subtype && (subtype.includes('error') || subtype.includes('fail'))
        ? 'PostToolUseFailure'
        : null) ??
      readString(input.event) ??
      type,
  )
  const toolName =
    readString(input.tool_name) ??
    readString(input.toolName) ??
    readString(input.name) ??
    readNested(input.tool, 'name')
  const mapped = mapGrokEvent(nativeEventType, toolName)
  const toolInput = input.tool_input ?? input.toolInput ?? input.input
  const filePaths = extractToolFilePaths({ toolName, toolInput })
  const filePath =
    filePaths[0] ??
    readString(input.file_path) ??
    readString(input.path) ??
    readNested(input.worktree, 'path')
  const safeFilePath = filePath ? sanitizeObservedPath(filePath) : null
  const commandCategory = isPlainObject(toolInput)
    ? classifyCommandCategory(toolInput.command)
    : classifyCommandCategory(input.command)
  const sessionId =
    readString(input.session_id) ??
    readString(input.sessionId) ??
    readNested(input.session, 'id')
  const toolUseId =
    readString(input.tool_use_id) ??
    readString(input.toolUseId) ??
    readString(input.id)
  const cwd = readString(input.cwd) ?? readString(input.workspace)
  const resource = inferResource(mapped.normalizedType, safeFilePath, toolName)
  const payload = pickAllowlistedPayload({
    nativeEventType,
    origin: 'stream-json',
    ...(toolName ? { toolName } : {}),
    ...(safeFilePath ? { filePath: safeFilePath } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    ...(commandCategory !== 'unknown' ? { commandCategory } : {}),
  })

  return {
    id: createObserverEventId(),
    schemaVersion: OBSERVER_SCHEMA_VERSION,
    occurredAt,
    receivedAt,
    source: 'grok-build',
    surface: inferStreamSurface(input),
    nativeEventType: nativeEventType.slice(0, 512) || 'unknown',
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
    actorKind: nativeEventType.toLowerCase().includes('subagent')
      ? 'subagent'
      : 'agent',
    activity: mapped.activity,
    resource,
    summary: summarize(nativeEventType, safeFilePath),
    attributionConfidence: 'verified',
    ingestionMethod: 'stream-json',
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

function inferStreamSurface(
  input: Record<string, unknown>,
): NormalizedObserverEvent['surface'] {
  const hint = (
    readString(input.surface) ??
    readString(input.client) ??
    ''
  ).toLowerCase()
  if (hint.includes('cli') || hint.includes('headless')) {
    return 'cli'
  }
  if (hint.includes('desktop') || hint.includes('app')) {
    return 'desktop-app'
  }
  return 'unknown'
}

function inferResource(
  type: NormalizedObserverEvent['normalizedType'],
  filePath: string | null,
  toolName: string | null,
): NormalizedObserverEvent['resource'] {
  const action = toolActionForName(toolName)
  if (action === 'execute' || type.startsWith('command.')) {
    return { type: 'command', key: 'command', action: 'execute' }
  }
  if (type.startsWith('worktree.')) {
    return {
      type: 'worktree',
      key: filePath ?? 'worktree',
      action: type.endsWith('removed') ? 'delete' : 'create',
    }
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
  filePath: string | null,
): string | null {
  if (nativeEventType === 'SessionStart') {
    return 'Grok Buildの作業が始まりました'
  }
  if (nativeEventType === 'SessionEnd') {
    return 'Grok Buildの作業が終わりました'
  }
  if (filePath) {
    return 'Grok Buildがファイルを扱っています'
  }
  return 'Grok Buildの様子が届きました'
}

function streamType(input: Record<string, unknown>): string | null {
  return (
    readString(input.type) ??
    readString(input.event) ??
    readString(input.sessionUpdate) ??
    readNested(input.update, 'sessionUpdate')
  )
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
