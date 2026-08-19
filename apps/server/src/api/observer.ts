import { readFileSync } from 'node:fs'
import { AppError } from '@sikumi-local/core'
import {
  applyConflictTransition,
  clipList,
  conflictIdParamSchema,
  conflictMutationBodySchema,
  inboundObserverBatchSchema,
  inboundObserverEventSchema,
  INSTALL_PLAN_DIGEST_MISMATCH_MESSAGE,
  listConflictsQuerySchema,
  OBSERVER_API_DEFAULT_LIST_LIMIT,
  OBSERVER_API_MAX_LIST_LIMIT,
  OBSERVER_MAX_PATH_CHARS,
  observerAdapterActionRequestSchema,
  observerInstallResultSchema,
  realUserHome,
  shouldGrantRealUserApply,
  updateSessionLabelRequestSchema,
  type ConflictFinding,
  type ObserverAdapterActionRequest,
  type ObserverInstallFilePlan,
  type ObserverInstallOptions,
  type ObserverInstallResult,
} from '@sikumi-local/observer-core'
import type { FastifyInstance } from 'fastify'
import {
  eventsAfter,
  readSseCursor,
  startSseStream,
  wantsEventStream,
} from '../jobs/sse.js'
import type { ObserverService } from '../observer/service.js'
import {
  presentConflictView,
  type ConflictApiView,
} from '../observer/conflict-view.js'
import type { ObserverViewMode } from '../observer/views.js'
import {
  assertSseAllowed,
  type SecurityConfig,
} from '../security/http-guard.js'
import { createObserverId } from '../storage/observer-store.js'
import type { CombinedStore } from '../storage/store.js'

export function toInstallOptions(
  input: ObserverAdapterActionRequest,
  store: CombinedStore,
): ObserverInstallOptions {
  const scope = input.scope ?? 'user'
  if (scope === 'repo') {
    if (!input.repositoryId) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Repository 限定の導入には repositoryId が必要です',
        400,
      )
    }
    const repository = store.getRegisteredRepository(input.repositoryId)
    if (!repository) {
      throw new AppError('NOT_FOUND', '未登録の Repository です', 404)
    }
    return {
      scope: 'repo',
      repositoryId: repository.id,
      repoDir: repository.absolutePath,
      ...(input.confirm === undefined ? {} : { confirm: input.confirm }),
      ...(input.confirmationToken === undefined
        ? {}
        : { confirmationToken: input.confirmationToken }),
      ...(input.planDigest === undefined
        ? {}
        : { planDigest: input.planDigest }),
    }
  }
  return {
    scope: 'user',
    homeDir: realUserHome(),
    ...(input.confirm === undefined ? {} : { confirm: input.confirm }),
    ...(input.confirmationToken === undefined
      ? {}
      : { confirmationToken: input.confirmationToken }),
    ...(input.planDigest === undefined ? {} : { planDigest: input.planDigest }),
  }
}

export async function applyObserverAdapterRequest(
  observer: Pick<ObserverService, 'installAdapter' | 'uninstallAdapter'>,
  store: CombinedStore,
  source: string,
  action: 'install' | 'uninstall',
  input: ObserverAdapterActionRequest,
): Promise<ObserverInstallResult> {
  const options = toInstallOptions(input, store)
  const previewOptions: ObserverInstallOptions = {
    ...options,
    confirm: false,
  }
  const preview =
    action === 'install'
      ? await observer.installAdapter(source, previewOptions)
      : await observer.uninstallAdapter(source, previewOptions)
  if (input.confirm !== true) {
    return presentAdapterInstallCopy(source, action, preview, 'preview')
  }
  if (
    !shouldGrantRealUserApply(
      { confirm: true, ...digestFields(input) },
      preview,
    )
  ) {
    return {
      ...preview,
      ok: false,
      applied: false,
      changed: false,
      requiresConfirm: true,
      message: INSTALL_PLAN_DIGEST_MISMATCH_MESSAGE,
    }
  }
  const granted: ObserverInstallOptions = {
    ...options,
    confirm: true,
    allowRealUserApply: true,
    ...digestFields(input),
  }
  const applied =
    action === 'install'
      ? await observer.installAdapter(source, granted)
      : await observer.uninstallAdapter(source, granted)
  return presentAdapterInstallCopy(source, action, applied, 'apply')
}

export function presentAdapterInstallCopy(
  source: string,
  action: 'install' | 'uninstall',
  result: ObserverInstallResult,
  mode: 'preview' | 'apply' = 'preview',
): ObserverInstallResult {
  if (source === 'claude-desktop' || !result.ok) {
    return result
  }
  if (mode === 'apply' && result.requiresConfirm !== true) {
    return {
      ...result,
      applied: true,
      message: action === 'install' ? 'つながりました' : 'はずしました',
    }
  }
  if (result.applied === true) {
    return {
      ...result,
      message: action === 'install' ? 'つながりました' : 'はずしました',
    }
  }
  if (!looksLikeTechnicalInstallCopy(result.message)) {
    return result
  }
  return {
    ...result,
    message:
      action === 'install'
        ? 'つなぐ準備ができました'
        : 'はずす準備ができました',
  }
}

const INSTALL_PREVIEW_MAX = 20_000
const INSTALL_MESSAGE_MAX = 500
const INSTALL_EVIDENCE_MAX = 280
const INSTALL_TOKEN_MAX = 128

export function presentObserverInstallApiResult(
  result: ObserverInstallResult,
): ObserverInstallResult {
  const sanitized = sanitizeInstallResultForApi(result)
  if (observerInstallResultSchema.safeParse(sanitized).success) {
    return sanitized
  }
  return fallbackInstallResult(result)
}

function sanitizeInstallResultForApi(
  result: ObserverInstallResult,
): ObserverInstallResult {
  const files = publicInstallFiles(result.files)
  const preview = files
    .map((file) => `${file.action} ${file.path}`)
    .join('\n')
    .slice(0, INSTALL_PREVIEW_MAX)
  const evidence = (result.evidence ?? [])
    .slice(0, 20)
    .map((item) => clipInstallText(item, INSTALL_EVIDENCE_MAX))
    .filter((item) => item.length > 0)
  return {
    ok: result.ok,
    changed: result.changed,
    message: publicInstallMessage(result),
    ...(preview.length > 0 ? { preview } : {}),
    ...(result.requiresConfirm === undefined
      ? {}
      : { requiresConfirm: result.requiresConfirm }),
    ...(result.applied === undefined ? {} : { applied: result.applied }),
    ...(files.length > 0 ? { files } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(result.confirmationToken
      ? {
          confirmationToken: clipInstallText(
            result.confirmationToken,
            INSTALL_TOKEN_MAX,
          ),
        }
      : {}),
    ...(result.planDigest
      ? { planDigest: clipInstallText(result.planDigest, INSTALL_TOKEN_MAX) }
      : {}),
    ...(result.targetRoot
      ? {
          targetRoot: clipInstallText(
            result.targetRoot,
            OBSERVER_MAX_PATH_CHARS,
          ),
        }
      : {}),
  }
}

function publicInstallFiles(
  files: ObserverInstallResult['files'],
): ObserverInstallFilePlan[] {
  return (files ?? []).slice(0, 20).flatMap((file) => {
    const path = clipInstallText(file.path, OBSERVER_MAX_PATH_CHARS)
    if (path.length === 0) {
      return []
    }
    return [
      {
        path,
        action: file.action,
        preview: '',
      },
    ]
  })
}

function publicInstallMessage(result: ObserverInstallResult): string {
  const clipped = clipInstallText(result.message, INSTALL_MESSAGE_MAX)
  if (clipped.length > 0) {
    return clipped
  }
  if (result.ok) {
    return result.applied === true ? 'つながりました' : 'つなぐ準備ができました'
  }
  return 'つなぎ直せませんでした'
}

function fallbackInstallResult(
  result: ObserverInstallResult,
): ObserverInstallResult {
  return {
    ok: result.ok,
    changed: result.changed,
    applied: result.applied === true,
    ...(result.requiresConfirm === undefined
      ? {}
      : { requiresConfirm: result.requiresConfirm }),
    message: publicInstallMessage(result),
  }
}

function clipInstallText(value: string, max: number): string {
  return value.trim().slice(0, max)
}

function looksLikeTechnicalInstallCopy(message: string): boolean {
  return (
    message.includes('導入差分です') ||
    message.includes('有効とはしません') ||
    message.includes('有効としません')
  )
}

function digestFields(input: ObserverAdapterActionRequest): {
  readonly confirmationToken?: string
  readonly planDigest?: string
} {
  return {
    ...(input.confirmationToken === undefined
      ? {}
      : { confirmationToken: input.confirmationToken }),
    ...(input.planDigest === undefined ? {} : { planDigest: input.planDigest }),
  }
}

function readViewMode(query: unknown): ObserverViewMode {
  if (
    typeof query === 'object' &&
    query !== null &&
    'mode' in query &&
    query.mode === 'detail'
  ) {
    return 'detail'
  }
  return 'simple'
}

export function registerObserverRoutes(
  app: FastifyInstance,
  observer: ObserverService,
  store: CombinedStore,
  security: SecurityConfig,
): void {
  app.get('/api/observer/today', async (request) => ({
    overview: observer.today(readViewMode(request.query)),
  }))

  app.get('/api/observer/adapters', async () => ({
    adapters: observer.listAdapters(),
  }))

  app.post<{ Params: { source: string } }>(
    '/api/observer/adapters/:source/check',
    async (request) => ({
      adapter: await observer.checkAdapter(request.params.source),
    }),
  )

  app.get<{ Params: { source: string } }>(
    '/api/observer/adapters/:source/package',
    async (request, reply) => {
      const generated = observer.generatedPackage(request.params.source)
      if (!generated) {
        throw new AppError(
          'NOT_FOUND',
          '生成済みの協調報告パッケージがありません',
          404,
        )
      }
      const body = readFileSync(generated.path)
      return reply
        .header('content-type', 'application/octet-stream')
        .header(
          'content-disposition',
          `attachment; filename="${generated.filename}"`,
        )
        .send(body)
    },
  )

  app.post<{ Params: { source: string } }>(
    '/api/observer/adapters/:source/install',
    async (request) => {
      const parsed = observerAdapterActionRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        throw new AppError('VALIDATION_FAILED', '導入リクエストが不正です', 400)
      }
      const result = await applyObserverAdapterRequest(
        observer,
        store,
        request.params.source,
        'install',
        parsed.data,
      )
      return { result: presentObserverInstallApiResult(result) }
    },
  )

  app.post<{ Params: { source: string } }>(
    '/api/observer/adapters/:source/uninstall',
    async (request) => {
      const parsed = observerAdapterActionRequestSchema.safeParse(
        request.body ?? {},
      )
      if (!parsed.success) {
        throw new AppError('VALIDATION_FAILED', '解除リクエストが不正です', 400)
      }
      const result = await applyObserverAdapterRequest(
        observer,
        store,
        request.params.source,
        'uninstall',
        parsed.data,
      )
      return { result: presentObserverInstallApiResult(result) }
    },
  )

  app.post('/api/observer/events', async (request, reply) => {
    const parsed = inboundObserverEventSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError(
        'OBSERVER_EVENT_INVALID',
        'Observer event is invalid',
        400,
      )
    }
    const event = observer.acceptEvent(parsed.data)
    return reply.status(201).send({ event })
  })

  app.post('/api/observer/events/batch', async (request, reply) => {
    const parsed = inboundObserverBatchSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError(
        'OBSERVER_EVENT_INVALID',
        'Observer batch is invalid',
        400,
      )
    }
    const events = observer.acceptBatch(parsed.data)
    return reply.status(201).send({ events })
  })

  app.get('/api/observer/events/stream', async (request, reply) => {
    const cursor = readSseCursor(
      request.headers['last-event-id'],
      request.query,
    )
    const snapshot = () =>
      observer.hub.listRecent().map((event) => ({
        id: event.id,
        jobId: null,
        runId: null,
        type: 'run.state_changed' as const,
        payload: {
          observerType: event.type,
          observer: event.payload,
        },
        occurredAt: event.occurredAt,
      }))

    if (wantsEventStream(request.headers.accept)) {
      assertSseAllowed(request, security)
      reply.hijack()
      startSseStream({
        raw: reply.raw,
        replay: () => {
          const events = snapshot()
          if (!cursor) {
            return events
          }
          return eventsAfter(events, cursor)
        },
        subscribe: (listener) =>
          observer.hub.subscribe((event) => {
            listener({
              id: event.id,
              jobId: null,
              runId: null,
              type: 'run.state_changed',
              payload: {
                observerType: event.type,
                observer: event.payload,
              },
              occurredAt: event.occurredAt,
            })
          }),
      })
      return
    }

    return { events: snapshot() }
  })

  app.get('/api/external-sessions', async (request) => {
    const repositoryId =
      typeof request.query === 'object' &&
      request.query !== null &&
      'repositoryId' in request.query &&
      typeof request.query.repositoryId === 'string'
        ? request.query.repositoryId
        : undefined
    const listed = store.listExternalSessions(
      repositoryId ? { repositoryId } : undefined,
    )
    const bounded = clipList(listed, OBSERVER_API_DEFAULT_LIST_LIMIT)
    return {
      sessions: bounded.items,
      total: bounded.total,
      truncated: bounded.truncated,
    }
  })

  app.get<{ Params: { id: string } }>(
    '/api/external-sessions/:id',
    async (request) => {
      const session = store.getExternalSession(request.params.id)
      if (!session) {
        throw new AppError('NOT_FOUND', '外部セッションが見つかりません', 404)
      }
      return {
        session,
        label: store.getSessionLabel(session.id) ?? null,
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/external-sessions/:id/events',
    async (request) => {
      const session = store.getExternalSession(request.params.id)
      if (!session) {
        throw new AppError('NOT_FOUND', '外部セッションが見つかりません', 404)
      }
      const listed = store.listObserverEvents({ sessionId: session.id })
      const bounded = clipList(listed, OBSERVER_API_DEFAULT_LIST_LIMIT)
      return {
        events: bounded.items,
        total: bounded.total,
        truncated: bounded.truncated,
      }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/external-sessions/:id/label',
    async (request) => {
      const session = store.getExternalSession(request.params.id)
      if (!session) {
        throw new AppError('NOT_FOUND', '外部セッションが見つかりません', 404)
      }
      const parsed = updateSessionLabelRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError('VALIDATION_FAILED', 'ラベルが不正です', 400)
      }
      const now = new Date().toISOString()
      const existing = store.getSessionLabel(session.id)
      const label = store.upsertSessionLabel({
        id: existing?.id ?? createObserverId(),
        externalSessionId: session.id,
        title:
          parsed.data.title === undefined
            ? (existing?.title ?? null)
            : parsed.data.title,
        summary:
          parsed.data.summary === undefined
            ? (existing?.summary ?? null)
            : parsed.data.summary,
        source: 'user',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      return { label }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/repositories/:id/activity',
    async (request) => ({
      activity: observer.scanRepository(
        request.params.id,
        readViewMode(request.query),
      ),
    }),
  )

  app.post<{ Params: { id: string } }>(
    '/api/repositories/:id/rescan',
    async (request) => ({
      activity: observer.scanRepository(
        request.params.id,
        readViewMode(request.query),
      ),
    }),
  )

  app.get<{ Params: { id: string } }>(
    '/api/repositories/:id/worktrees',
    async (request) => {
      const activity = observer.scanRepository(request.params.id, 'detail')
      return {
        worktrees: activity.worktrees,
        truncated: activity.truncated,
        warnings: activity.warnings,
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/repositories/:id/snapshots',
    async (request) => {
      const listed = store.listRepositorySnapshots(request.params.id)
      const bounded = clipList(listed, OBSERVER_API_MAX_LIST_LIMIT)
      return {
        snapshots: bounded.items,
        total: bounded.total,
        truncated: bounded.truncated,
      }
    },
  )

  app.get('/api/conflicts', async (request) => {
    const parsed = listConflictsQuerySchema.safeParse(request.query ?? {})
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', '競合の絞り込みが不正です', 400)
    }
    const mode = readViewMode(request.query)
    const listed = store
      .listConflicts({
        ...(parsed.data.repositoryId
          ? { repositoryId: parsed.data.repositoryId }
          : {}),
        ...(parsed.data.source ? { source: parsed.data.source } : {}),
        ...(parsed.data.level ? { level: parsed.data.level } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.unconfirmed ? { unconfirmed: true } : {}),
      })
      .map((item) => presentConflictView(item, store, mode))
    const bounded = clipList(listed, OBSERVER_API_MAX_LIST_LIMIT)
    return {
      conflicts: bounded.items,
      counts: countConflictTones(listed),
      total: bounded.total,
      truncated: bounded.truncated,
    }
  })

  app.get<{ Params: { id: string } }>('/api/conflicts/:id', async (request) => {
    const finding = requireConflict(store, request.params.id)
    return {
      conflict: presentConflictView(
        finding,
        store,
        readViewMode(request.query),
      ),
    }
  })

  app.post<{ Params: { id: string } }>(
    '/api/conflicts/:id/acknowledge',
    async (request) => {
      assertEmptyConflictBody(request.body)
      const finding = requireConflict(store, request.params.id)
      const next = store.upsertConflict(
        applyConflictTransition(
          finding,
          'acknowledge',
          new Date().toISOString(),
        ),
      )
      return { conflict: presentConflictView(next, store, 'simple') }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/conflicts/:id/resolve',
    async (request) => {
      assertEmptyConflictBody(request.body)
      const finding = requireConflict(store, request.params.id)
      const next = store.upsertConflict(
        applyConflictTransition(finding, 'resolve', new Date().toISOString()),
      )
      return { conflict: presentConflictView(next, store, 'simple') }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/conflicts/:id/recheck',
    async (request) => {
      assertEmptyConflictBody(request.body)
      const finding = requireConflict(store, request.params.id)
      const repository = store.getRegisteredRepository(finding.repositoryId)
      if (!repository) {
        throw new AppError('NOT_FOUND', '登録した場所が見つかりません', 404)
      }
      observer.scanRepository(finding.repositoryId, 'detail')
      const next =
        store.getConflict(finding.id) ?? store.getConflict(finding.identityKey)
      if (!next) {
        throw new AppError('NOT_FOUND', '競合が見つかりません', 404)
      }
      return { conflict: presentConflictView(next, store, 'simple') }
    },
  )
}

function requireConflict(store: CombinedStore, rawId: string): ConflictFinding {
  const parsed = conflictIdParamSchema.safeParse(rawId)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', '競合の指定が不正です', 400)
  }
  const finding = store.getConflict(parsed.data)
  if (!finding) {
    throw new AppError('NOT_FOUND', '競合が見つかりません', 404)
  }
  return finding
}

function assertEmptyConflictBody(body: unknown): void {
  const parsed = conflictMutationBodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'リクエストが不正です', 400)
  }
}

function countConflictTones(conflicts: readonly ConflictApiView[]): {
  readonly red: number
  readonly orange: number
  readonly yellow: number
} {
  return conflicts.reduce(
    (counts, item) => {
      if (item.status === 'resolved') {
        return counts
      }
      if (item.level === 'high' || item.level === 'critical') {
        return { ...counts, red: counts.red + 1 }
      }
      if (item.level === 'caution') {
        return { ...counts, orange: counts.orange + 1 }
      }
      if (item.level === 'related') {
        return { ...counts, yellow: counts.yellow + 1 }
      }
      return counts
    },
    { red: 0, orange: 0, yellow: 0 },
  )
}
