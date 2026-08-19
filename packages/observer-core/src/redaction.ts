import {
  AppError,
  redactSensitiveText,
  textContainsSecrets,
} from '@sikumi-local/core'
import {
  OBSERVER_MAX_EVENT_BYTES,
  OBSERVER_MAX_PAYLOAD_KEYS,
  OBSERVER_MAX_PAYLOAD_VALUE,
  OBSERVER_MAX_SUMMARY_CHARS,
} from './limits.js'

export {
  OBSERVER_MAX_EVENT_BYTES,
  OBSERVER_MAX_PAYLOAD_KEYS,
  OBSERVER_MAX_PAYLOAD_VALUE,
  OBSERVER_MAX_SUMMARY_CHARS,
} from './limits.js'

export const OBSERVER_PAYLOAD_ALLOWLIST = [
  'toolName',
  'toolUseId',
  'filePath',
  'previousPath',
  'commandCategory',
  'commandName',
  'permissionKind',
  'permissionMode',
  'taskTitle',
  'nativeEventType',
  'changeType',
  'addedLines',
  'deletedLines',
  'resourceType',
  'resourceKey',
  'action',
  'surfaceHint',
  'worktreeHint',
  'model',
  'matcher',
  'origin',
  'hookVersion',
  'aggregatedCount',
] as const

export type ObserverPayloadKey = (typeof OBSERVER_PAYLOAD_ALLOWLIST)[number]

const ALLOWLIST = new Set<string>(OBSERVER_PAYLOAD_ALLOWLIST)

const DENIED_KEYS = new Set([
  'prompt',
  'userPrompt',
  'user_prompt',
  'response',
  'agentResponse',
  'transcript',
  'transcriptPath',
  'transcript_path',
  'reasoning',
  'thinking',
  'chain_of_thought',
  'chainOfThought',
  'hiddenReasoning',
  'token',
  'tokens',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'oauth',
  'oauthToken',
  'oauth_token',
  'cookie',
  'cookies',
  'setCookie',
  'set_cookie',
  'cookieHeader',
  'authorization',
  'authHeader',
  'auth_header',
  'apiKey',
  'api_key',
  'xApiKey',
  'x_api_key',
  'privateKey',
  'private_key',
  'clientSecret',
  'client_secret',
  'env',
  'environment',
  'envVars',
  'envFile',
  'dotenv',
  'diff',
  'fullDiff',
  'patch',
  'content',
  'fileContents',
  'fileContent',
  'body',
  'stdout',
  'stderr',
  'output',
  'input',
  'arguments',
  'args',
  'toolInput',
  'tool_input',
  'toolOutput',
  'tool_output',
  'toolResponse',
  'toolResult',
  'tool_result',
  'messages',
  'conversation',
  'conversationHistory',
  'systemPrompt',
  'hidden_reasoning',
])

export function assertEventSizeLimit(raw: string | Buffer): void {
  const bytes =
    typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.length
  if (bytes > OBSERVER_MAX_EVENT_BYTES) {
    throw new AppError(
      'OBSERVER_EVENT_INVALID',
      'Observer event is too large',
      413,
    )
  }
}

export function isDeniedObserverKey(key: string): boolean {
  const normalized = key.trim()
  if (DENIED_KEYS.has(normalized) || DENIED_KEYS.has(toCamel(normalized))) {
    return true
  }
  const lower = normalized.toLowerCase().replaceAll(/[_-]/g, '')
  return (
    lower.includes('prompt') ||
    lower.includes('transcript') ||
    lower.includes('reasoning') ||
    lower.includes('cookie') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('password') ||
    lower.includes('authorization') ||
    lower.includes('oauth') ||
    lower.includes('apikey') ||
    lower.includes('privatekey') ||
    lower.includes('filecontent') ||
    lower.endsWith('diff') ||
    lower.endsWith('patch') ||
    lower === 'env' ||
    lower.includes('dotenv') ||
    lower.includes('stdout') ||
    lower.includes('stderr')
  )
}

export function pickAllowlistedPayload(input: unknown): Record<string, string> {
  if (!isPlainObject(input)) {
    return {}
  }
  const picked: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(picked).length >= OBSERVER_MAX_PAYLOAD_KEYS) {
      break
    }
    if (!ALLOWLIST.has(key) || isDeniedObserverKey(key)) {
      continue
    }
    const serialized = serializePayloadValue(value)
    if (serialized === null) {
      continue
    }
    const redacted = redactSensitiveText(serialized).slice(
      0,
      OBSERVER_MAX_PAYLOAD_VALUE,
    )
    if (redacted.length === 0 || textContainsSecrets(redacted)) {
      continue
    }
    picked[key] = redacted
  }
  return picked
}

export function sanitizeObserverSummary(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || textContainsSecrets(trimmed)) {
    return null
  }
  const redacted = redactSensitiveText(trimmed).slice(
    0,
    OBSERVER_MAX_SUMMARY_CHARS,
  )
  if (redacted !== trimmed.slice(0, OBSERVER_MAX_SUMMARY_CHARS)) {
    return null
  }
  return redacted
}

export function extractAllowlistedFields(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const aliases: Record<string, ObserverPayloadKey> = {
    tool_name: 'toolName',
    toolName: 'toolName',
    tool_use_id: 'toolUseId',
    toolUseId: 'toolUseId',
    file_path: 'filePath',
    filePath: 'filePath',
    path: 'filePath',
    previous_path: 'previousPath',
    previousPath: 'previousPath',
    command_category: 'commandCategory',
    commandCategory: 'commandCategory',
    command_name: 'commandName',
    commandName: 'commandName',
    permission_kind: 'permissionKind',
    permissionKind: 'permissionKind',
    permission_mode: 'permissionMode',
    permissionMode: 'permissionMode',
    model: 'model',
    matcher: 'matcher',
    origin: 'origin',
    task_title: 'taskTitle',
    taskTitle: 'taskTitle',
    change_type: 'changeType',
    changeType: 'changeType',
    added_lines: 'addedLines',
    addedLines: 'addedLines',
    deleted_lines: 'deletedLines',
    deletedLines: 'deletedLines',
    resource_type: 'resourceType',
    resourceType: 'resourceType',
    resource_key: 'resourceKey',
    resourceKey: 'resourceKey',
    action: 'action',
  }

  const extracted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (isDeniedObserverKey(key)) {
      continue
    }
    const mapped = aliases[key]
    if (mapped) {
      extracted[mapped] = value
    }
  }

  const nestedCandidates = [raw.payload, raw.event, raw.data, raw.tool]
  for (const candidate of nestedCandidates) {
    if (isPlainObject(candidate)) {
      Object.assign(extracted, extractAllowlistedFields(candidate))
    }
  }
  return extracted
}

function serializePayloadValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toCamel(value: string): string {
  return value.replace(/[_-](\w)/g, (_, letter: string) => letter.toUpperCase())
}
