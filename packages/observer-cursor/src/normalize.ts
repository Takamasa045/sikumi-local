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
import {
  isCursorHookEvent,
  isCursorTabEvent,
  mapCursorEvent,
} from './events.js'
import { inferCursorSurface, looksLikeCloudAgent } from './surface.js'

export function normalizeCursorHook(
  input: unknown,
): NormalizedObserverEvent | null {
  try {
    return normalizeCursorHookOrNull(input)
  } catch {
    return null
  }
}

function normalizeCursorHookOrNull(
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
      readString(input.occurredAt) ?? readString(input.timestamp) ?? receivedAt,
    ) ?? receivedAt
  const conversationId =
    readString(input.conversation_id) ??
    readString(input.conversationId) ??
    readString(input.session_id) ??
    readString(input.sessionId)
  const cwd =
    readString(input.cwd) ??
    firstString(input.workspace_roots) ??
    firstString(input.workspaceRoots)
  const surface = inferCursorSurface(input, nativeEventType)
  const sessionId = isCursorTabEvent(nativeEventType)
    ? `tab:${conversationId ?? cwd ?? 'unknown'}`
    : conversationId
  const toolName =
    readString(input.tool_name) ??
    readString(input.toolName) ??
    readNested(input.tool, 'name')
  const mapped = mapCursorEvent(nativeEventType, toolName)
  const toolInput = input.tool_input ?? input.toolInput ?? input.input
  const filePaths = extractToolFilePaths({ toolName, toolInput })
  const filePath =
    filePaths[0] ??
    readString(input.file_path) ??
    readString(input.filePath) ??
    readString(input.path) ??
    null
  const safeFilePath = filePath ? sanitizeObservedPath(filePath) : null
  const commandValue = isPlainObject(toolInput)
    ? toolInput.command
    : input.command
  const commandCategory = classifyCommandCategory(commandValue)
  const toolUseId =
    readString(input.tool_use_id) ??
    readString(input.toolUseId) ??
    readNested(input.tool, 'id') ??
    readString(input.generation_id)
  const resource = inferResource(
    mapped.normalizedType,
    safeFilePath,
    toolName,
    nativeEventType,
  )
  const payload = pickAllowlistedPayload({
    nativeEventType,
    surfaceHint: surface,
    ...(toolName ? { toolName } : {}),
    ...(safeFilePath ? { filePath: safeFilePath } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    ...(commandCategory !== 'unknown' ? { commandCategory } : {}),
    ...(readString(input.model) ? { model: readString(input.model) } : {}),
    ...(looksLikeCloudAgent(input) ? { origin: 'unsupported-cloud' } : {}),
    ...(readString(input.cursor_version) || readString(input.hook_version)
      ? {
          hookVersion:
            readString(input.cursor_version) ?? readString(input.hook_version),
        }
      : {}),
  })

  return {
    id: createObserverEventId(),
    schemaVersion: OBSERVER_SCHEMA_VERSION,
    occurredAt,
    receivedAt,
    source: 'cursor',
    surface,
    nativeEventType:
      isCursorHookEvent(nativeEventType) || nativeEventType.length <= 512
        ? nativeEventType.slice(0, 512) || 'unknown'
        : nativeEventType.slice(0, 512),
    normalizedType: mapped.normalizedType,
    externalSessionId: sessionId,
    externalTurnId:
      readString(input.generation_id) ??
      readString(input.turn_id) ??
      readString(input.turnId),
    externalTaskId: readString(input.task_id) ?? readString(input.taskId),
    externalSubagentId:
      readString(input.subagent_id) ??
      readString(input.subagentId) ??
      readString(input.agent_id),
    cwd,
    repositoryId: null,
    worktreePath: cwd,
    branch: readString(input.branch),
    baseCommit: null,
    headCommit: null,
    actorKind: inferActor(nativeEventType),
    activity: mapped.activity,
    resource,
    summary: summarize(nativeEventType, toolName, safeFilePath, surface),
    attributionConfidence: 'verified',
    ingestionMethod: 'hook',
    idempotencyKey: buildIdempotencyKey({
      source: 'cursor',
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
  if (nativeEventType.startsWith('subagent')) {
    return 'subagent'
  }
  if (nativeEventType === 'beforeSubmitPrompt') {
    return 'human'
  }
  if (isCursorTabEvent(nativeEventType)) {
    return 'agent'
  }
  return 'agent'
}

function inferResource(
  type: NormalizedObserverEvent['normalizedType'],
  filePath: string | null,
  toolName: string | null,
  nativeEventType: string,
): ObserverResource | null {
  if (
    nativeEventType === 'beforeShellExecution' ||
    nativeEventType === 'afterShellExecution'
  ) {
    return { type: 'command', key: 'command', action: 'execute' }
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
  surface: string,
): string | null {
  if (surface === 'cursor-tab') {
    return filePath
      ? 'Cursor Tabがファイルを扱っています'
      : 'Cursor Tabの小さな編集があります'
  }
  if (nativeEventType === 'sessionStart') {
    return 'Cursorの作業が始まりました'
  }
  if (nativeEventType === 'sessionEnd') {
    return 'Cursorの作業が終わりました'
  }
  if (nativeEventType === 'subagentStart') {
    return 'Cursorのサブエージェントが始まりました'
  }
  if (
    nativeEventType === 'beforeShellExecution' ||
    nativeEventType === 'afterShellExecution'
  ) {
    return 'Cursorがコマンドを扱っています'
  }
  if (filePath) {
    return 'Cursorがファイルを扱っています'
  }
  if (toolName) {
    return 'Cursorが道具を使っています'
  }
  return 'Cursorの様子が届きました'
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readNested(value: unknown, key: string): string | null {
  return isPlainObject(value) ? readString(value[key]) : null
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null
  }
  for (const item of value) {
    const text = readString(item)
    if (text) {
      return text
    }
  }
  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
