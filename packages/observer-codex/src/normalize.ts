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
import { isCodexHookEvent, mapCodexEvent } from './events.js'

export function normalizeCodexHook(
  input: unknown,
): NormalizedObserverEvent | null {
  try {
    return normalizeCodexHookOrNull(input)
  } catch {
    return null
  }
}

function normalizeCodexHookOrNull(
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
  const sessionId =
    readString(input.session_id) ?? readString(input.sessionId) ?? null
  const turnId = readString(input.turn_id) ?? readString(input.turnId) ?? null
  const toolName =
    readString(input.tool_name) ??
    readString(input.toolName) ??
    readNestedString(input.tool, 'name')
  const mapped = mapCodexEvent(nativeEventType, toolName)
  const toolInput = input.tool_input ?? input.toolInput ?? input.input
  const filePaths = extractToolFilePaths({ toolName, toolInput })
  const filePath = filePaths[0] ?? readString(input.file_path) ?? null
  const safeFilePath = filePath ? sanitizeObservedPath(filePath) : null
  const commandCategory = isPlainObject(toolInput)
    ? classifyCommandCategory(toolInput.command)
    : 'unknown'
  const toolUseId =
    readString(input.tool_use_id) ??
    readString(input.toolUseId) ??
    readNestedString(input.tool, 'use_id')
  const cwd = readString(input.cwd)
  const resource = inferResource(mapped.normalizedType, safeFilePath, toolName)
  const payload = pickAllowlistedPayload({
    nativeEventType,
    ...(toolName ? { toolName } : {}),
    ...(safeFilePath ? { filePath: safeFilePath } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    ...(commandCategory !== 'unknown' ? { commandCategory } : {}),
    ...(readString(input.permission_mode) || readString(input.permissionMode)
      ? {
          permissionMode:
            readString(input.permission_mode) ??
            readString(input.permissionMode),
        }
      : {}),
    ...(readString(input.model) ? { model: readString(input.model) } : {}),
    ...(readString(input.permission_kind)
      ? { permissionKind: readString(input.permission_kind) }
      : {}),
  })

  return {
    id: createObserverEventId(),
    schemaVersion: OBSERVER_SCHEMA_VERSION,
    occurredAt,
    receivedAt,
    source: 'codex',
    surface: inferCodexSurface(input),
    nativeEventType: isCodexHookEvent(nativeEventType)
      ? nativeEventType
      : nativeEventType.slice(0, 512) || 'unknown',
    normalizedType: mapped.normalizedType,
    externalSessionId: sessionId,
    externalTurnId: turnId,
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
    summary: summarizeCodex(nativeEventType, toolName, safeFilePath),
    attributionConfidence: 'verified',
    ingestionMethod: 'hook',
    idempotencyKey: buildIdempotencyKey({
      source: 'codex',
      externalSessionId: sessionId,
      nativeEventType,
      toolUseId,
      occurredAt,
      resourcePath: resource?.key ?? safeFilePath,
    }),
    payload,
  }
}

function inferCodexSurface(input: Record<string, unknown>): ObserverSurface {
  const hint = (
    readString(input.surface) ??
    readString(input.client) ??
    readString(input.app) ??
    ''
  ).toLowerCase()
  if (
    hint.includes('desktop') ||
    hint === 'app' ||
    hint.includes('codex app')
  ) {
    return 'desktop-app'
  }
  if (hint.includes('cli') || hint.includes('terminal')) {
    return 'cli'
  }
  if (hint.includes('ide') || hint.includes('vscode')) {
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
  if (nativeEventType === 'PermissionRequest') {
    return 'agent'
  }
  return 'agent'
}

function inferResource(
  type: NormalizedObserverEvent['normalizedType'],
  filePath: string | null,
  toolName: string | null,
): ObserverResource | null {
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

function summarizeCodex(
  nativeEventType: string,
  toolName: string | null,
  filePath: string | null,
): string | null {
  if (nativeEventType === 'SessionStart') {
    return 'Codexの作業が始まりました'
  }
  if (nativeEventType === 'SessionEnd') {
    return 'Codexの作業が終わりました'
  }
  if (nativeEventType === 'PermissionRequest') {
    return 'Codexが確認を待っています'
  }
  if (nativeEventType === 'SubagentStart') {
    return 'Codexのサブエージェントが始まりました'
  }
  if (filePath) {
    return `Codexがファイルを扱っています`
  }
  if (toolName) {
    return 'Codexが道具を使っています'
  }
  return 'Codexの様子が届きました'
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function readNestedString(value: unknown, key: string): string | null {
  if (!isPlainObject(value)) {
    return null
  }
  return readString(value[key])
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
