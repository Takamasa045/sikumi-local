import { writeSpoolEvent } from '@sikumi-local/observer-bridge'
import {
  nowIso,
  resourceActions,
  resourceTypes,
  sanitizeObserverSummary,
  type ResourceAction,
  type ResourceType,
} from '@sikumi-local/observer-core'
import {
  readRegisteredRepositoryCatalog,
  type RegisteredRepositoryRecord,
} from './catalog.js'
import {
  CLAUDE_DESKTOP_INSTRUCTION,
  COOPERATIVE_REPORTING_NOTICE,
  MAX_PATH_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TOOL_PAYLOAD_BYTES,
  MAX_TOOL_PAYLOAD_DEPTH,
  MAX_TOOL_PAYLOAD_KEYS,
  SIKUMI_MCP_TOOLS,
  type SikumiMcpToolName,
} from './events.js'
import { normalizeClaudeDesktopReport } from './normalize.js'
import {
  matchRegisteredRepository,
  pathsReferToSameLocation,
  resolveResourceInsideRepository,
} from './paths.js'
import {
  createOpaqueSessionId,
  getCooperativeSession,
  isOpaqueSessionId,
  upsertCooperativeSession,
  type CooperativeSession,
  type CooperativeSessionStatus,
} from './sessions.js'

export interface CooperativeToolContext {
  readonly dataDirectory: string
  readonly now?: string
}

export interface CooperativeToolSuccess {
  readonly ok: true
  readonly tool: SikumiMcpToolName
  readonly message: string
  readonly cooperative: true
  readonly reported: boolean
  readonly sessionId?: string
  readonly status?: CooperativeSessionStatus
  readonly repositoryId?: string
  readonly repositories?: ReadonlyArray<{
    readonly id: string
    readonly displayName: string
    readonly path: string
  }>
}

export interface CooperativeToolFailure {
  readonly ok: false
  readonly tool: SikumiMcpToolName | 'unknown'
  readonly message: string
  readonly cooperative: true
  readonly code:
    | 'invalid_input'
    | 'unregistered_repository'
    | 'unsafe_path'
    | 'unknown_session'
    | 'invalid_transition'
    | 'oversized'
}

export type CooperativeToolResult =
  CooperativeToolSuccess | CooperativeToolFailure

const UNSAFE_INPUT_KEYS = [
  'prompt',
  'response',
  'content',
  'transcript',
  'secret',
  'token',
  'apiKey',
  'authorization',
  'env',
  'message',
  'messages',
  'toolBody',
  'tool_body',
  'fileContents',
  'file_contents',
]

const CLOSED_STATUSES: readonly CooperativeSessionStatus[] = [
  'completed',
  'failed',
]

export const SIKUMI_TOOL_DESCRIPTIONS: Record<SikumiMcpToolName, string> = {
  'sikumi.list_registered_repositories':
    'List repositories registered in Sikumi-local. Cooperative reporting only; this does not observe chat automatically.',
  'sikumi.begin_work':
    'Start cooperative reporting for work in one registered repository. Call this first. Does not control Claude and does not capture the prompt.',
  'sikumi.update_work':
    'Update the cooperative summary or activity of an open reported session. Use when the work scope changes.',
  'sikumi.note_resource':
    'Report metadata about a file or other resource inside the registered repository. Store only the path and action, never file contents.',
  'sikumi.waiting_for_user':
    'Report that the cooperative session is waiting for the user. Does not pause or control Claude.',
  'sikumi.complete_work':
    'Mark a cooperative session as completed. Call this when the reported work is done.',
  'sikumi.fail_work':
    'Mark a cooperative session as failed. Call this when the reported work cannot continue.',
}

export const SIKUMI_TOOL_SCHEMAS: Record<
  SikumiMcpToolName,
  Record<string, unknown>
> = {
  'sikumi.list_registered_repositories': {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  'sikumi.begin_work': {
    type: 'object',
    additionalProperties: false,
    required: ['repositoryPath'],
    properties: {
      repositoryPath: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_PATH_LENGTH,
        description: 'Absolute path of a Sikumi-local registered repository.',
      },
      summary: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_SUMMARY_LENGTH,
        description: 'Short work summary. Do not include prompts or secrets.',
      },
      sessionId: {
        type: 'string',
        minLength: 8,
        maxLength: 128,
        description: 'Optional opaque session id for idempotent begin_work.',
      },
    },
  },
  'sikumi.update_work': {
    type: 'object',
    additionalProperties: false,
    required: ['sessionId'],
    properties: {
      sessionId: { type: 'string', minLength: 8, maxLength: 128 },
      summary: { type: 'string', minLength: 1, maxLength: MAX_SUMMARY_LENGTH },
      activity: {
        type: 'string',
        enum: [
          'planning',
          'reading',
          'editing',
          'reviewing',
          'testing',
          'idle',
        ],
      },
    },
  },
  'sikumi.note_resource': {
    type: 'object',
    additionalProperties: false,
    required: ['sessionId', 'resourceType', 'resourceKey', 'action'],
    properties: {
      sessionId: { type: 'string', minLength: 8, maxLength: 128 },
      resourceType: { type: 'string', enum: [...resourceTypes] },
      resourceKey: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_PATH_LENGTH,
        description: 'Path inside the registered repository. Metadata only.',
      },
      action: { type: 'string', enum: [...resourceActions] },
    },
  },
  'sikumi.waiting_for_user': {
    type: 'object',
    additionalProperties: false,
    required: ['sessionId'],
    properties: {
      sessionId: { type: 'string', minLength: 8, maxLength: 128 },
      summary: { type: 'string', minLength: 1, maxLength: MAX_SUMMARY_LENGTH },
    },
  },
  'sikumi.complete_work': {
    type: 'object',
    additionalProperties: false,
    required: ['sessionId'],
    properties: {
      sessionId: { type: 'string', minLength: 8, maxLength: 128 },
      summary: { type: 'string', minLength: 1, maxLength: MAX_SUMMARY_LENGTH },
    },
  },
  'sikumi.fail_work': {
    type: 'object',
    additionalProperties: false,
    required: ['sessionId'],
    properties: {
      sessionId: { type: 'string', minLength: 8, maxLength: 128 },
      summary: { type: 'string', minLength: 1, maxLength: MAX_SUMMARY_LENGTH },
    },
  },
}

export function listSikumiTools(): ReadonlyArray<{
  readonly name: SikumiMcpToolName
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}> {
  return SIKUMI_MCP_TOOLS.map((name) => ({
    name,
    description: `${SIKUMI_TOOL_DESCRIPTIONS[name]} ${COOPERATIVE_REPORTING_NOTICE}`,
    inputSchema: SIKUMI_TOOL_SCHEMAS[name],
  }))
}

export function cooperativeInstructionText(): string {
  return CLAUDE_DESKTOP_INSTRUCTION
}

export function callSikumiTool(
  name: string,
  rawArgs: unknown,
  context: CooperativeToolContext,
): CooperativeToolResult {
  try {
    if (!isSikumiTool(name)) {
      return failure('unknown', 'invalid_input', '未対応の Tool です')
    }
    const inspected = inspectToolPayload(rawArgs)
    if (!inspected.ok) {
      return failure(name, inspected.code, inspected.message)
    }
    const args = asObject(rawArgs)
    if (!args) {
      return failure(
        name,
        'invalid_input',
        '引数は object である必要があります',
      )
    }
    if (hasUnsafeInput(args)) {
      return failure(
        name,
        'invalid_input',
        'Prompt、本文、秘密情報は受け取れません。メタデータだけ送ってください',
      )
    }
    const validated = validateAgainstSchema(name, args)
    if (!validated.ok) {
      return validated
    }
    switch (name) {
      case 'sikumi.list_registered_repositories':
        return listRepositories(context)
      case 'sikumi.begin_work':
        return beginWork(args, context)
      case 'sikumi.update_work':
        return updateWork(args, context)
      case 'sikumi.note_resource':
        return noteResource(args, context)
      case 'sikumi.waiting_for_user':
        return waitingForUser(args, context)
      case 'sikumi.complete_work':
        return closeWork(args, context, 'completed')
      case 'sikumi.fail_work':
        return closeWork(args, context, 'failed')
    }
  } catch (error) {
    return failure(
      isSikumiTool(name) ? name : 'unknown',
      'invalid_input',
      error instanceof Error ? error.message : 'tool execution failed',
    )
  }
}

function listRepositories(
  context: CooperativeToolContext,
): CooperativeToolResult {
  const catalog = readRegisteredRepositoryCatalog(context.dataDirectory)
  return {
    ok: true,
    tool: 'sikumi.list_registered_repositories',
    cooperative: true,
    reported: true,
    message:
      catalog.repositories.length === 0
        ? '登録済み Repository はありません。Sikumi-local で場所を登録してください。'
        : `登録済み Repository は ${catalog.repositories.length} 件です。作業を始める前に sikumi.begin_work を使ってください。`,
    repositories: catalog.repositories.map((repository) => ({
      id: repository.id,
      displayName: repository.displayName,
      path: repository.absolutePath,
    })),
  }
}

function beginWork(
  args: Record<string, unknown>,
  context: CooperativeToolContext,
): CooperativeToolResult {
  const repositoryPath = readBoundedString(args.repositoryPath, MAX_PATH_LENGTH)
  if (repositoryPath === 'oversized') {
    return failure(
      'sikumi.begin_work',
      'oversized',
      'repositoryPath が長すぎます',
    )
  }
  if (!repositoryPath) {
    return failure(
      'sikumi.begin_work',
      'invalid_input',
      'repositoryPath は文字列で指定してください',
    )
  }
  const summary = readSummary(args.summary)
  if (summary === 'oversized') {
    return failure('sikumi.begin_work', 'oversized', 'summary が長すぎます')
  }
  if (summary === 'invalid') {
    return failure(
      'sikumi.begin_work',
      'invalid_input',
      'summary は短い文字列にしてください',
    )
  }
  const requestedId = readSessionId(args.sessionId)
  if (requestedId === 'invalid') {
    return failure(
      'sikumi.begin_work',
      'invalid_input',
      'sessionId は opaque な短い文字列にしてください',
    )
  }
  const repository = resolveRegistered(repositoryPath, context)
  if (!repository) {
    return failure(
      'sikumi.begin_work',
      'unregistered_repository',
      '登録済み Repository だけを受け取れます。未登録の場所や symlink 脱出は拒否します',
    )
  }
  const now = context.now ?? nowIso()
  if (requestedId) {
    const existing = getCooperativeSession(context.dataDirectory, requestedId)
    if (existing) {
      const sameRepository =
        existing.repositoryId === repository.id &&
        pathsReferToSameLocation(
          existing.repositoryPath,
          repository.canonicalPath || repository.absolutePath,
        )
      if (!sameRepository || CLOSED_STATUSES.includes(existing.status)) {
        return failure(
          'sikumi.begin_work',
          'invalid_transition',
          'この sessionId は別の Repository か、すでに閉じた session に紐付いています',
        )
      }
      return succeed('sikumi.begin_work', existing, true, context, {
        summary: existing.summary,
        repositoryPath: existing.repositoryPath,
        repositoryId: existing.repositoryId,
      })
    }
  }
  const session = upsertCooperativeSession(context.dataDirectory, {
    id: requestedId ?? createOpaqueSessionId(),
    repositoryId: repository.id,
    repositoryPath: repository.canonicalPath || repository.absolutePath,
    status: 'active',
    summary,
    createdAt: now,
    updatedAt: now,
  })
  return succeed('sikumi.begin_work', session, false, context, {
    summary,
    repositoryPath: session.repositoryPath,
    repositoryId: session.repositoryId,
  })
}

function updateWork(
  args: Record<string, unknown>,
  context: CooperativeToolContext,
): CooperativeToolResult {
  const opened = requireOpenSession('sikumi.update_work', args, context)
  if (!opened.ok) {
    return opened
  }
  const summary = readSummary(args.summary)
  if (summary === 'oversized') {
    return failure('sikumi.update_work', 'oversized', 'summary が長すぎます')
  }
  if (summary === 'invalid') {
    return failure(
      'sikumi.update_work',
      'invalid_input',
      'summary は短い文字列にしてください',
    )
  }
  const now = context.now ?? nowIso()
  const session = upsertCooperativeSession(context.dataDirectory, {
    ...opened.session,
    status: 'active',
    summary: summary ?? opened.session.summary,
    updatedAt: now,
  })
  return succeed('sikumi.update_work', session, false, context, {
    summary: session.summary,
    activity: readOptionalString(args.activity),
    repositoryPath: session.repositoryPath,
    repositoryId: session.repositoryId,
  })
}

function noteResource(
  args: Record<string, unknown>,
  context: CooperativeToolContext,
): CooperativeToolResult {
  const opened = requireOpenSession('sikumi.note_resource', args, context)
  if (!opened.ok) {
    return opened
  }
  const resourceType = readOptionalString(args.resourceType)
  const resourceKey = readBoundedString(args.resourceKey, MAX_PATH_LENGTH)
  const action = readOptionalString(args.action)
  if (resourceKey === 'oversized') {
    return failure(
      'sikumi.note_resource',
      'oversized',
      'resourceKey が長すぎます',
    )
  }
  if (!resourceType || !isResourceType(resourceType)) {
    return failure(
      'sikumi.note_resource',
      'invalid_input',
      'resourceType が不正です',
    )
  }
  if (!action || !isResourceAction(action)) {
    return failure('sikumi.note_resource', 'invalid_input', 'action が不正です')
  }
  if (!resourceKey) {
    return failure(
      'sikumi.note_resource',
      'invalid_input',
      'resourceKey は文字列で指定してください',
    )
  }
  const resolved = resolveResourceInsideRepository(
    resourceKey,
    opened.session.repositoryPath,
  )
  if (!resolved) {
    return failure(
      'sikumi.note_resource',
      'unsafe_path',
      'resource は登録Repositoryの内側だけです。traversal や symlink 脱出は拒否します',
    )
  }
  const now = context.now ?? nowIso()
  const session = upsertCooperativeSession(context.dataDirectory, {
    ...opened.session,
    updatedAt: now,
  })
  return succeed('sikumi.note_resource', session, false, context, {
    resourceType,
    resourceKey: resolved.relativeKey,
    action,
    repositoryPath: session.repositoryPath,
    repositoryId: session.repositoryId,
  })
}

function waitingForUser(
  args: Record<string, unknown>,
  context: CooperativeToolContext,
): CooperativeToolResult {
  const opened = requireOpenSession('sikumi.waiting_for_user', args, context)
  if (!opened.ok) {
    return opened
  }
  const summary = readSummary(args.summary)
  if (summary === 'oversized') {
    return failure(
      'sikumi.waiting_for_user',
      'oversized',
      'summary が長すぎます',
    )
  }
  if (summary === 'invalid') {
    return failure(
      'sikumi.waiting_for_user',
      'invalid_input',
      'summary は短い文字列にしてください',
    )
  }
  const now = context.now ?? nowIso()
  const session = upsertCooperativeSession(context.dataDirectory, {
    ...opened.session,
    status: 'waiting-for-user',
    summary: summary ?? opened.session.summary,
    updatedAt: now,
  })
  return succeed('sikumi.waiting_for_user', session, false, context, {
    summary: session.summary,
    repositoryPath: session.repositoryPath,
    repositoryId: session.repositoryId,
  })
}

function closeWork(
  args: Record<string, unknown>,
  context: CooperativeToolContext,
  status: 'completed' | 'failed',
): CooperativeToolResult {
  const tool =
    status === 'completed' ? 'sikumi.complete_work' : 'sikumi.fail_work'
  const sessionId = readSessionId(args.sessionId)
  if (sessionId === 'invalid' || !sessionId) {
    return failure(tool, 'invalid_input', 'sessionId が不正です')
  }
  const existing = getCooperativeSession(context.dataDirectory, sessionId)
  if (!existing) {
    return failure(tool, 'unknown_session', '未知の sessionId です')
  }
  const summary = readSummary(args.summary)
  if (summary === 'oversized') {
    return failure(tool, 'oversized', 'summary が長すぎます')
  }
  if (summary === 'invalid') {
    return failure(tool, 'invalid_input', 'summary は短い文字列にしてください')
  }
  if (CLOSED_STATUSES.includes(existing.status)) {
    if (existing.status === status) {
      return succeed(tool, existing, true, context, {
        summary: existing.summary,
        repositoryPath: existing.repositoryPath,
        repositoryId: existing.repositoryId,
      })
    }
    return failure(
      tool,
      'invalid_transition',
      `この session はすでに ${existing.status} です`,
    )
  }
  const now = context.now ?? nowIso()
  const session = upsertCooperativeSession(context.dataDirectory, {
    ...existing,
    status,
    summary: summary ?? existing.summary,
    updatedAt: now,
  })
  return succeed(tool, session, false, context, {
    summary: session.summary,
    repositoryPath: session.repositoryPath,
    repositoryId: session.repositoryId,
  })
}

function requireOpenSession(
  tool: SikumiMcpToolName,
  args: Record<string, unknown>,
  context: CooperativeToolContext,
):
  | { readonly ok: true; readonly session: CooperativeSession }
  | CooperativeToolFailure {
  const sessionId = readSessionId(args.sessionId)
  if (sessionId === 'invalid' || !sessionId) {
    return failure(tool, 'invalid_input', 'sessionId が不正です')
  }
  const existing = getCooperativeSession(context.dataDirectory, sessionId)
  if (!existing) {
    return failure(tool, 'unknown_session', '未知の sessionId です')
  }
  if (CLOSED_STATUSES.includes(existing.status)) {
    return failure(
      tool,
      'invalid_transition',
      `完了または失敗した session は更新できません`,
    )
  }
  return { ok: true, session: existing }
}

function succeed(
  tool: SikumiMcpToolName,
  session: CooperativeSession,
  idempotent: boolean,
  context: CooperativeToolContext,
  extras: Record<string, unknown>,
): CooperativeToolSuccess {
  const reported = idempotent
    ? false
    : emitReport(tool, session, extras, context)
  return {
    ok: true,
    tool,
    cooperative: true,
    reported,
    sessionId: session.id,
    status: session.status,
    repositoryId: session.repositoryId,
    message: idempotent
      ? `同じ session の ${tool} を再実行しました。Claude の作業は止めません。`
      : toolSuccessMessage(tool, session),
  }
}

function emitReport(
  tool: SikumiMcpToolName,
  session: CooperativeSession,
  extras: Record<string, unknown>,
  context: CooperativeToolContext,
): boolean {
  try {
    const event = normalizeClaudeDesktopReport({
      type: tool,
      sessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryPath: session.repositoryPath,
      cwd: session.repositoryPath,
      summary: session.summary,
      occurredAt: context.now ?? nowIso(),
      ...extras,
    })
    if (!event) {
      return false
    }
    const written = writeSpoolEvent(context.dataDirectory, event)
    return written.written === true
  } catch {
    return false
  }
}

function resolveRegistered(
  repositoryPath: string,
  context: CooperativeToolContext,
): RegisteredRepositoryRecord | null {
  const catalog = readRegisteredRepositoryCatalog(context.dataDirectory)
  return matchRegisteredRepository(repositoryPath, catalog.repositories)
}

function toolSuccessMessage(
  tool: SikumiMcpToolName,
  session: CooperativeSession,
): string {
  switch (tool) {
    case 'sikumi.begin_work':
      return `協調報告を開始しました。sessionId=${session.id}。通常チャットの自動全観測ではありません。`
    case 'sikumi.update_work':
      return '作業内容の協調報告を更新しました。'
    case 'sikumi.note_resource':
      return '対象のメタデータだけを記録しました。本文は保存しません。'
    case 'sikumi.waiting_for_user':
      return 'ユーザー確認待ちとして協調報告しました。Claude は制御しません。'
    case 'sikumi.complete_work':
      return '自己申告による作業を完了として記録しました。'
    case 'sikumi.fail_work':
      return '自己申告による作業を失敗として記録しました。'
    default:
      return '協調報告を受け取りました。'
  }
}

function failure(
  tool: SikumiMcpToolName | 'unknown',
  code: CooperativeToolFailure['code'],
  message: string,
): CooperativeToolFailure {
  return { ok: false, tool, cooperative: true, code, message }
}

function readSessionId(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string' || !isOpaqueSessionId(value.trim())) {
    return 'invalid'
  }
  return value.trim()
}

function readSummary(value: unknown): string | null | 'oversized' | 'invalid' {
  if (value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    return 'invalid'
  }
  if (value.length > MAX_SUMMARY_LENGTH) {
    return 'oversized'
  }
  const sanitized = sanitizeObserverSummary(value)
  if (value.trim().length > 0 && sanitized === null) {
    return 'invalid'
  }
  return sanitized
}

function readBoundedString(
  value: unknown,
  max: number,
): string | null | 'oversized' {
  if (typeof value !== 'string') {
    return null
  }
  if (value.length > max) {
    return 'oversized'
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function hasUnsafeInput(value: unknown): boolean {
  return findUnsafeKey(value, 0) !== null
}

function findUnsafeKey(value: unknown, depth: number): string | null {
  if (depth > MAX_TOOL_PAYLOAD_DEPTH || value === null || value === undefined) {
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findUnsafeKey(item, depth + 1)
      if (nested) {
        return nested
      }
    }
    return null
  }
  if (!isPlainRecord(value)) {
    return null
  }
  for (const [key, child] of Object.entries(value)) {
    if (isUnsafeKey(key)) {
      return key
    }
    const nested = findUnsafeKey(child, depth + 1)
    if (nested) {
      return nested
    }
  }
  return null
}

function isUnsafeKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (
    lower === '__proto__' ||
    lower === 'constructor' ||
    lower === 'prototype'
  ) {
    return true
  }
  return UNSAFE_INPUT_KEYS.some(
    (denied) =>
      lower === denied.toLowerCase() || lower.includes(denied.toLowerCase()),
  )
}

function inspectToolPayload(value: unknown):
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: CooperativeToolFailure['code']
      readonly message: string
    } {
  if (value === undefined || value === null) {
    return { ok: true }
  }
  if (!isPlainRecord(value) && !Array.isArray(value)) {
    return {
      ok: false,
      code: 'invalid_input',
      message: '引数は object である必要があります',
    }
  }
  let encoded: string
  try {
    encoded = JSON.stringify(value) ?? ''
  } catch {
    return {
      ok: false,
      code: 'invalid_input',
      message: '引数は JSON として扱える object である必要があります',
    }
  }
  if (encoded.length > MAX_TOOL_PAYLOAD_BYTES) {
    return { ok: false, code: 'oversized', message: '引数が大きすぎます' }
  }
  const walked = walkPayloadShape(value, 0)
  if (!walked.ok) {
    return walked
  }
  return { ok: true }
}

function walkPayloadShape(
  value: unknown,
  depth: number,
):
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: CooperativeToolFailure['code']
      readonly message: string
    } {
  if (value === null || typeof value !== 'object') {
    return { ok: true }
  }
  if (depth > MAX_TOOL_PAYLOAD_DEPTH) {
    return {
      ok: false,
      code: 'oversized',
      message: '引数のネストが深すぎます',
    }
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_TOOL_PAYLOAD_KEYS) {
      return { ok: false, code: 'oversized', message: '引数が大きすぎます' }
    }
    for (const item of value) {
      const nested = walkPayloadShape(item, depth + 1)
      if (!nested.ok) {
        return nested
      }
    }
    return { ok: true }
  }
  if (!isPlainRecord(value)) {
    return {
      ok: false,
      code: 'invalid_input',
      message: '引数は plain object である必要があります',
    }
  }
  const keys = Object.keys(value)
  if (keys.length > MAX_TOOL_PAYLOAD_KEYS) {
    return { ok: false, code: 'oversized', message: '引数が大きすぎます' }
  }
  for (const child of Object.values(value)) {
    const nested = walkPayloadShape(child, depth + 1)
    if (!nested.ok) {
      return nested
    }
  }
  return { ok: true }
}

function validateAgainstSchema(
  tool: SikumiMcpToolName,
  args: Record<string, unknown>,
): { readonly ok: true } | CooperativeToolFailure {
  const schema = SIKUMI_TOOL_SCHEMAS[tool]
  const properties = isPlainRecord(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : []
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!(key in properties)) {
        return failure(
          tool,
          'invalid_input',
          `未対応のフィールド ${key} は受け取れません`,
        )
      }
    }
  }
  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      return failure(tool, 'invalid_input', `${key} は必須です`)
    }
  }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) {
      continue
    }
    const property = properties[key]
    if (!isPlainRecord(property)) {
      continue
    }
    const checked = checkSchemaProperty(tool, key, property, value)
    if (checked) {
      return checked
    }
  }
  return { ok: true }
}

function checkSchemaProperty(
  tool: SikumiMcpToolName,
  key: string,
  schema: Record<string, unknown>,
  value: unknown,
): CooperativeToolFailure | null {
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return failure(
        tool,
        'invalid_input',
        `${key} は文字列である必要があります`,
      )
    }
    if (
      typeof schema.minLength === 'number' &&
      value.length < schema.minLength
    ) {
      return failure(tool, 'invalid_input', `${key} が短すぎます`)
    }
    if (
      typeof schema.maxLength === 'number' &&
      value.length > schema.maxLength
    ) {
      return failure(tool, 'oversized', `${key} が長すぎます`)
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      return failure(tool, 'invalid_input', `${key} が不正です`)
    }
    return null
  }
  if (schema.type === 'object') {
    if (!isPlainRecord(value)) {
      return failure(
        tool,
        'invalid_input',
        `${key} は object である必要があります`,
      )
    }
  }
  return null
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return {}
  }
  if (!isPlainRecord(value)) {
    return null
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isSikumiTool(value: string): value is SikumiMcpToolName {
  return (SIKUMI_MCP_TOOLS as readonly string[]).includes(value)
}

function isResourceType(value: string): value is ResourceType {
  return (resourceTypes as readonly string[]).includes(value)
}

function isResourceAction(value: string): value is ResourceAction {
  return (resourceActions as readonly string[]).includes(value)
}
