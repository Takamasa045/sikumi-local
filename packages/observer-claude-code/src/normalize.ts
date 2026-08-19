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
} from '@sikumi-local/observer-core'
import { isClaudeCodeHookEvent, mapClaudeCodeEvent } from './events.js'
import { inferClaudeCodeSurface } from './surface.js'

export function normalizeClaudeCodeHook(
  input: unknown,
): NormalizedObserverEvent | null {
  try {
    return normalizeClaudeCodeHookOrNull(input)
  } catch {
    return null
  }
}

function normalizeClaudeCodeHookOrNull(
  input: unknown,
): NormalizedObserverEvent | null {
  if (!isPlainObject(input)) {
    return null
  }

  const nativeEventType =
    readString(input.hook_event_name) ??
    readString(input.nativeEventType) ??
    readString(input.event) ??
    'unknown'
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
  const mapped = mapClaudeCodeEvent(nativeEventType, toolName)
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
    : 'unknown'
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
    ...(readString(input.matcher) ? { matcher: readString(input.matcher) } : {}),
    ...(readString(input.permission_mode)
      ? { permissionMode: readString(input.permission_mode) }
      : {}),
    ...(readString(input.model) ? { model: readString(input.model) } : {}),
  })

  return {
    id: createObserverEventId(),
    schemaVersion: OBSERVER_SCHEMA_VERSION,
    occurredAt,
    receivedAt,
    source: 'claude-code',
    surface: inferClaudeCodeSurface(input),
    nativeEventType: isClaudeCodeHookEvent(nativeEventType)
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
      source: 'claude-code',
      externalSessionId: sessionId,
      nativeEventType,
      toolUseId,
      occurredAt,
      resourcePath: resource?.key ?? safeFilePath,
    }),
    payload,
  }
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
      type: nativeEventType === 'DirectoryAdded' ? 'directory' : 'file',
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
    return 'Claude Codeの作業が始まりました'
  }
  if (nativeEventType === 'SessionEnd') {
    return 'Claude Codeの作業が終わりました'
  }
  if (nativeEventType === 'PermissionRequest' || nativeEventType === 'Notification') {
    return 'Claude Codeが確認を待っています'
  }
  if (nativeEventType === 'SubagentStart') {
    return 'Claude Codeのサブエージェントが始まりました'
  }
  if (nativeEventType === 'TaskCreated') {
    return 'Claude Codeが仕事を分けました'
  }
  if (filePath) {
    return 'Claude Codeがファイルを扱っています'
  }
  if (toolName) {
    return 'Claude Codeが道具を使っています'
  }
  return 'Claude Codeの様子が届きました'
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
