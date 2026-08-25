import { existsSync, readFileSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { AppError } from '@sikumi-local/core'
import { createClaudeCodeObserverAdapter } from '@sikumi-local/observer-claude-code'
import {
  claudeDesktopMcpbPath,
  createClaudeDesktopObserverAdapter,
  writeRegisteredRepositoryCatalog,
} from '@sikumi-local/observer-claude-desktop'
import { createCodexObserverAdapter } from '@sikumi-local/observer-codex'
import { createCursorObserverAdapter } from '@sikumi-local/observer-cursor'
import { createGrokObserverAdapter } from '@sikumi-local/observer-grok'
import {
  createObserverEventId,
  defaultObserverAdapters,
  isEnabledInstallationStatus,
  isObserverSourceId,
  nowIso,
  OBSERVER_MAX_BATCH_BYTES,
  OBSERVER_MAX_BATCH_COUNT,
  OBSERVER_MAX_EVENT_BYTES,
  OBSERVER_MAX_SPOOL_EVENTS_PER_SWEEP,
  OBSERVER_MAX_SPOOL_FILE_BYTES,
  OBSERVER_MAX_SPOOL_FILE_LINES,
  OBSERVER_MAX_SPOOL_FILES_PER_SWEEP,
  OBSERVER_CONSISTENCY_INTERVAL_MS,
  OBSERVER_LIVE_SCAN_THROTTLE_MS,
  OBSERVER_SCAN_DEBOUNCE_MS,
  OBSERVER_SCAN_THROTTLE_MS,
  realUserHome,
  projectInboundEvent,
  applyConflictTransition,
  rememberAdapterObservation,
  toAdapterRecord,
  type AttentionItem,
  type ControlPlaneSnapshot,
  type NormalizedObserverEvent,
  type ObserverAdapter,
  type ObserverInstallOptions,
  type ObserverInstallResult,
  type ObserverSourceId,
} from '@sikumi-local/observer-core'
import {
  ensureObserverLayout,
  hashSpoolBytes,
  listInboxFiles,
  moveSpoolFile,
  observerProcessedDir,
  quarantineSpoolFile,
  recordRejectedSpool,
} from '@sikumi-local/observer-bridge'
import {
  createGitObserverAdapter,
  readBlogArticleTitles,
  readBlogWorkStory,
  readLatestRecordTitle,
  readPlaceIntro,
  readRecentRecordTitles,
  readSyncCounts,
  snapshotGitRepository,
  type ChangedFileRecord,
} from '@sikumi-local/observer-git'
import {
  discoverLiveSessions,
  liveSightingToEvent,
  type LiveDiscoveryInput,
  type LiveProcessRow,
  type LiveSighting,
} from '@sikumi-local/observer-live'
import type { CombinedStore } from '../storage/store.js'
import { createObserverId } from '../storage/observer-store.js'
import { refreshConflicts } from './conflicts.js'
import { createObserverHub, type ObserverHub } from './hub.js'
import {
  createRepositoryWatcherCoordinator,
  unrefTimer,
  type RepositoryWatcherHandle,
} from './repository-watcher.js'
import { createScanScheduler } from './scan-scheduler.js'
import { markStaleSessions, upsertSessionFromEvent } from './sessions.js'
import {
  omitAcknowledgedAttention,
  readAttentionAcks,
  writeAttentionAck,
} from './attention-acks.js'
import { buildControlPlaneSnapshot } from './control-plane.js'
import {
  buildRepositoryActivity,
  buildTodayOverview,
  presentRepositoryActivity,
  type ObserverViewMode,
  type RepositoryActivityView,
  type TodayOverview,
} from './views.js'

export interface ObserverServiceOptions {
  readonly scanThrottleMs?: number
  readonly scanDebounceMs?: number
  readonly consistencyIntervalMs?: number
  readonly maxSpoolFilesPerSweep?: number
  readonly maxSpoolEventsPerSweep?: number
  readonly now?: () => number
  readonly setTimeoutFn?: typeof setTimeout
  readonly clearTimeoutFn?: typeof clearTimeout
  readonly setIntervalFn?: typeof setInterval
  readonly clearIntervalFn?: typeof clearInterval
  readonly watchFn?: (
    rootPath: string,
    listener: (eventType: string, filename: string | Buffer | null) => void,
  ) => RepositoryWatcherHandle
  readonly isWatchable?: (rootPath: string) => boolean
  readonly discoverLive?: (input: LiveDiscoveryInput) => readonly LiveSighting[]
  readonly listLiveProcesses?: () => readonly LiveProcessRow[]
  readonly liveHomeDir?: string
  readonly liveCurrentUser?: string
}

export interface ObserverService {
  readonly hub: ObserverHub
  dispose(): void
  recover(): Promise<void>
  ingestSpool(): number
  acceptEvent(raw: unknown, source?: ObserverSourceId): NormalizedObserverEvent
  acceptBatch(raw: unknown): NormalizedObserverEvent[]
  scanRepository(
    repositoryId: string,
    mode?: ObserverViewMode,
  ): RepositoryActivityView
  scanAll(): TodayOverview
  today(mode?: ObserverViewMode): TodayOverview
  controlPlane(): ControlPlaneSnapshot
  acknowledgeAttention(id: string): AttentionItem
  listAdapters(): ReturnType<CombinedStore['listAdapters']>
  checkAdapter(
    source: string,
  ): Promise<ReturnType<CombinedStore['listAdapters']>[number]>
  installAdapter(
    source: string,
    options?: ObserverInstallOptions,
  ): Promise<ObserverInstallResult>
  uninstallAdapter(
    source: string,
    options?: ObserverInstallOptions,
  ): Promise<ObserverInstallResult>
  generatedPackage(
    source: string,
  ): { readonly path: string; readonly filename: string } | null
}

export function createObserverService(
  store: CombinedStore,
  dataDirectory: string,
  options: ObserverServiceOptions = {},
): ObserverService {
  const hub = createObserverHub()
  const adapters = new Map<string, ObserverAdapter>()
  for (const adapter of defaultObserverAdapters()) {
    adapters.set(adapter.id, adapter)
  }
  adapters.set('codex', createCodexObserverAdapter())
  adapters.set('cursor', createCursorObserverAdapter())
  adapters.set('grok-build', createGrokObserverAdapter())
  adapters.set('claude-code', createClaudeCodeObserverAdapter())
  adapters.set('claude-desktop', createClaudeDesktopObserverAdapter())
  adapters.set('git', createGitObserverAdapter())
  ensureObserverLayout(dataDirectory)

  const maxSpoolFilesPerSweep =
    options.maxSpoolFilesPerSweep ?? OBSERVER_MAX_SPOOL_FILES_PER_SWEEP
  const maxSpoolEventsPerSweep =
    options.maxSpoolEventsPerSweep ?? OBSERVER_MAX_SPOOL_EVENTS_PER_SWEEP
  const consistencyIntervalMs =
    options.consistencyIntervalMs ?? OBSERVER_CONSISTENCY_INTERVAL_MS
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval
  let disposed = false
  let consistencyTimer: ReturnType<typeof setInterval> | undefined
  let lastLiveScanAt = 0

  const scheduler = createScanScheduler({
    scan: (repositoryId) => {
      if (disposed) {
        return
      }
      scanRepositoryInternal(repositoryId)
    },
    throttleMs: options.scanThrottleMs ?? OBSERVER_SCAN_THROTTLE_MS,
    debounceMs: options.scanDebounceMs ?? OBSERVER_SCAN_DEBOUNCE_MS,
    ...(options.now ? { now: options.now } : {}),
    ...(options.setTimeoutFn ? { setTimeoutFn: options.setTimeoutFn } : {}),
    ...(options.clearTimeoutFn
      ? { clearTimeoutFn: options.clearTimeoutFn }
      : {}),
  })
  const watchers = createRepositoryWatcherCoordinator({
    schedule: (repositoryId) => {
      if (disposed) {
        return
      }
      scheduler.schedule(repositoryId)
    },
    ...(options.watchFn ? { watchFn: options.watchFn } : {}),
    ...(options.isWatchable ? { isWatchable: options.isWatchable } : {}),
  })

  const service: ObserverService = {
    hub,
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      scheduler.clear()
      watchers.dispose()
      if (consistencyTimer !== undefined) {
        clearIntervalFn(consistencyTimer)
        consistencyTimer = undefined
      }
    },
    async recover() {
      if (disposed) {
        return
      }
      service.ingestSpool()
      reconcileRegisteredWatchers()
      await seedAdapters()
      if (disposed) {
        return
      }
      syncRegisteredRepositoryCatalog()
      markStaleSessions(store)
      ingestLiveDiscovery({ force: true })
      service.scanAll()
    },
    ingestSpool() {
      if (disposed) {
        return 0
      }
      let accepted = 0
      let processedFiles = 0
      for (const file of listInboxFiles(dataDirectory)) {
        if (
          processedFiles >= maxSpoolFilesPerSweep ||
          accepted >= maxSpoolEventsPerSweep
        ) {
          break
        }
        processedFiles += 1
        let fileBytes: number
        try {
          fileBytes = statSync(file.path).size
        } catch {
          quarantineSpoolFile(file.path, dataDirectory, {
            source: file.source,
            fileName: file.path,
            fileHash: hashSpoolBytes(file.path),
            errorCategory: 'read-error',
          })
          continue
        }
        if (fileBytes > OBSERVER_MAX_SPOOL_FILE_BYTES) {
          quarantineSpoolFile(file.path, dataDirectory, {
            source: file.source,
            fileName: file.path,
            fileHash: hashSpoolBytes(`oversized:${fileBytes}`),
            errorCategory: 'oversized',
          })
          continue
        }
        let raw: string
        try {
          raw = readFileSync(file.path, 'utf8')
        } catch {
          quarantineSpoolFile(file.path, dataDirectory, {
            source: file.source,
            fileName: file.path,
            fileHash: hashSpoolBytes(file.path),
            errorCategory: 'read-error',
          })
          continue
        }
        const lines = raw
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0)
        let hadFailure = false
        let lineIndex = 0
        for (const line of lines) {
          lineIndex += 1
          if (lineIndex > OBSERVER_MAX_SPOOL_FILE_LINES) {
            hadFailure = true
            recordRejectedSpool(dataDirectory, {
              source: file.source,
              fileName: file.path,
              fileHash: hashSpoolBytes(`line-budget:${lineIndex}`),
              errorCategory: 'oversized',
              occurredAt: nowIso(),
            })
            continue
          }
          if (Buffer.byteLength(line, 'utf8') > OBSERVER_MAX_EVENT_BYTES) {
            hadFailure = true
            recordRejectedSpool(dataDirectory, {
              source: file.source,
              fileName: file.path,
              fileHash: hashSpoolBytes(line),
              errorCategory: 'oversized',
              occurredAt: nowIso(),
            })
            continue
          }
          try {
            service.acceptEvent(JSON.parse(line), file.source)
            accepted += 1
          } catch (error) {
            hadFailure = true
            const category =
              error instanceof SyntaxError ? 'json-parse' : 'validation'
            recordRejectedSpool(dataDirectory, {
              source: file.source,
              fileName: file.path,
              fileHash: hashSpoolBytes(line),
              errorCategory: category,
              occurredAt: nowIso(),
            })
          }
        }
        if (hadFailure) {
          quarantineSpoolFile(file.path, dataDirectory, {
            source: file.source,
            fileName: file.path,
            fileHash: hashSpoolBytes(raw),
            errorCategory: 'validation',
          })
        } else {
          moveSpoolFile(file.path, observerProcessedDir(dataDirectory))
        }
      }
      return accepted
    },
    acceptEvent(raw, source) {
      let projected: NormalizedObserverEvent
      try {
        projected = projectWithAdapter(raw, source)
      } catch (error) {
        if (error instanceof AppError) {
          throw error
        }
        throw new AppError(
          'OBSERVER_EVENT_INVALID',
          'Observer event is invalid',
          400,
        )
      }
      const repositories = store.listRegisteredRepositories()
      const discoveredWorktrees = Object.fromEntries(
        repositories.map((repository) => [
          repository.id,
          store
            .latestSnapshotsByRepository(repository.id)
            .map((snapshot) => snapshot.worktreePath),
        ]),
      )
      const bound = upsertSessionFromEvent(
        store,
        projected,
        repositories,
        discoveredWorktrees,
      )
      if (bound.event.resource && bound.session.repositoryId) {
        store.upsertResourceClaim({
          id: createObserverId(),
          externalSessionId: bound.session.id,
          repositoryId: bound.session.repositoryId,
          resourceType: bound.event.resource.type,
          resourceKey: bound.event.resource.key,
          action: bound.event.resource.action,
          claimKind: 'observed',
          confidence: bound.session.attributionConfidence,
          firstObservedAt: bound.event.occurredAt,
          lastObservedAt: bound.event.occurredAt,
        })
      }
      const stored = store.insertObserverEvent(bound.event, {
        sessionId: bound.session.id,
      })
      if (stored.inserted) {
        hub.publish({
          id: stored.event.id,
          type: 'observer.event',
          payload: stored.event,
          occurredAt: stored.event.occurredAt,
        })
        touchAdapter(stored.event.source, stored.event.receivedAt)
        if (bound.session.repositoryId) {
          scheduler.schedule(bound.session.repositoryId)
        }
      }
      return stored.event
    },
    acceptBatch(raw) {
      if (typeof raw !== 'object' || raw === null || !('events' in raw)) {
        throw new AppError(
          'OBSERVER_EVENT_INVALID',
          'Batch must include events',
          400,
        )
      }
      const encoded = Buffer.byteLength(JSON.stringify(raw), 'utf8')
      if (encoded > OBSERVER_MAX_BATCH_BYTES) {
        throw new AppError(
          'OBSERVER_EVENT_INVALID',
          'Observer batch is too large',
          413,
        )
      }
      const events = (raw as { events: unknown }).events
      if (
        !Array.isArray(events) ||
        events.length === 0 ||
        events.length > OBSERVER_MAX_BATCH_COUNT
      ) {
        throw new AppError(
          'OBSERVER_EVENT_INVALID',
          'Batch size is invalid',
          400,
        )
      }
      return events.map((event) => service.acceptEvent(event))
    },
    scanRepository(repositoryId, mode = 'simple') {
      reconcileRegisteredWatchers()
      scheduler.force(repositoryId)
      return presentRepositoryActivity(activityFromStore(repositoryId), mode)
    },
    scanAll() {
      reconcileRegisteredWatchers()
      for (const repository of store.listRegisteredRepositories()) {
        try {
          scheduler.force(repository.id)
        } catch {
          // keep other repositories visible
        }
      }
      return service.today()
    },
    today(mode = 'simple') {
      syncRegisteredRepositoryCatalog()
      reconcileRegisteredWatchers()
      ingestLiveDiscovery()
      const registered = store.listRegisteredRepositories()
      for (const repository of registered) {
        try {
          scheduler.runIfDue(repository.id)
        } catch {
          // keep the rest visible
        }
      }
      const repositories = store
        .listRegisteredRepositories()
        .map((repository) => {
          const snapshot = latestSnapshotView(store, repository.id)
          return presentRepositoryActivity(
            buildRepositoryActivity({
              repository,
              snapshot,
              sessions: store.listExternalSessions({
                repositoryId: repository.id,
              }),
              labels: {},
              conflicts: store.listConflicts({ repositoryId: repository.id }),
              claims: store.listResourceClaims({ repositoryId: repository.id }),
            }),
            mode,
          )
        })
      return buildTodayOverview(repositories)
    },
    controlPlane() {
      syncRegisteredRepositoryCatalog()
      reconcileRegisteredWatchers()
      ingestLiveDiscovery()
      const registered = store.listRegisteredRepositories()
      for (const repository of registered) {
        try {
          scheduler.runIfDue(repository.id)
        } catch {
          // keep the rest visible
        }
      }
      const repositories = store.listRegisteredRepositories()
      const git = repositories.map((repository) => {
        const snapshot = latestSnapshotView(store, repository.id)
        return {
          repositoryId: repository.id,
          available: snapshot.available,
          changedFileCount: snapshot.changedFiles.length,
          changedPaths: snapshot.changedFiles.map((file) => file.path),
          scannedAt: snapshot.scannedAt,
        }
      })
      return omitAcknowledgedAttention(
        buildControlPlaneSnapshot({
          repositories: repositories.map((repository) => ({
            id: repository.id,
            displayName: repository.displayName,
            available:
              git.find((item) => item.repositoryId === repository.id)
                ?.available ?? true,
          })),
          sessions: store.listExternalSessions(),
          events: store.listObserverEvents(),
          claims: store.listResourceClaims(),
          conflicts: store.listConflicts(),
          adapters: store.listAdapters(),
          git,
        }),
        readAttentionAcks(dataDirectory),
      )
    },
    acknowledgeAttention(id) {
      const current = this.controlPlane()
      const visible = current.attention.find((item) => item.id === id)
      const raw = visible
        ? visible
        : buildControlPlaneSnapshot({
            repositories: store
              .listRegisteredRepositories()
              .map((repository) => ({
                id: repository.id,
                displayName: repository.displayName,
              })),
            sessions: store.listExternalSessions(),
            events: store.listObserverEvents(),
            claims: store.listResourceClaims(),
            conflicts: store.listConflicts(),
            adapters: store.listAdapters(),
          }).attention.find((item) => item.id === id)
      if (!raw) {
        throw new AppError('NOT_FOUND', '確認するものが見つかりません', 404)
      }
      writeAttentionAck(dataDirectory, raw.id)
      if (raw.conflictId) {
        const finding = store.getConflict(raw.conflictId)
        if (finding) {
          store.upsertConflict(
            applyConflictTransition(
              finding,
              'acknowledge',
              new Date().toISOString(),
            ),
          )
        }
      }
      return raw
    },
    listAdapters() {
      return store.listAdapters()
    },
    async checkAdapter(source) {
      const adapter = adapters.get(source)
      if (!adapter) {
        throw new AppError(
          'OBSERVER_ADAPTER_UNAVAILABLE',
          'この観測口はまだありません',
          404,
        )
      }
      return refreshAdapter(adapter)
    },
    async installAdapter(source, options) {
      return mutateAdapter('install', source, options)
    },
    async uninstallAdapter(source, options) {
      return mutateAdapter('uninstall', source, options)
    },
    generatedPackage(source) {
      if (source !== 'claude-desktop') {
        return null
      }
      const path = claudeDesktopMcpbPath(dataDirectory)
      if (!existsSync(path)) {
        return null
      }
      return { path, filename: 'sikumi-observer.mcpb' }
    },
  }

  function projectWithAdapter(
    raw: unknown,
    source?: ObserverSourceId,
  ): NormalizedObserverEvent {
    const inferredSource = source ?? readSource(raw)
    if (
      !alreadyProjected(raw) &&
      inferredSource &&
      shouldNormalizeWithAdapter(raw)
    ) {
      const adapter = adapters.get(inferredSource)
      const normalized = adapter?.normalize(raw)
      if (normalized) {
        return normalized
      }
    }
    return projectInboundEvent(raw, {
      ...(inferredSource ? { source: inferredSource } : {}),
      ingestionMethod: inferredSource ? 'hook' : 'http',
    })
  }

  async function mutateAdapter(
    action: 'install' | 'uninstall',
    source: string,
    options?: ObserverInstallOptions,
  ): Promise<ObserverInstallResult> {
    const adapter = adapters.get(source)
    if (!adapter) {
      throw new AppError(
        'OBSERVER_ADAPTER_UNAVAILABLE',
        'この観測口はまだありません',
        404,
      )
    }
    if (adapter.id === 'git') {
      return action === 'install'
        ? adapter.install(options)
        : adapter.uninstall(options)
    }
    const withDataDirectory: ObserverInstallOptions = {
      ...(options ?? {}),
      dataDirectory,
    }
    const result =
      action === 'install'
        ? await adapter.install(withDataDirectory)
        : await adapter.uninstall(withDataDirectory)
    if (result.applied) {
      try {
        await refreshAdapter(adapter)
      } catch {
        // A successful write must not become Unexpected server error.
      }
    }
    return result
  }

  async function refreshAdapter(adapter: ObserverAdapter) {
    const current = store.getAdapter(adapter.id)
    const lastEventAt = current?.lastEventAt ?? null
    const health = rememberAdapterObservation(
      await adapter.healthCheck({
        dataDirectory,
        ...(lastEventAt ? { lastEventAt } : {}),
      }),
      lastEventAt,
    )
    const now = nowIso()
    return store.upsertAdapter({
      ...toAdapterRecord(adapter, health, now),
      createdAt: current?.createdAt ?? now,
      lastEventAt: health.lastEventAt,
    })
  }

  async function seedAdapters() {
    for (const adapter of adapters.values()) {
      await refreshAdapter(adapter)
    }
  }

  function touchAdapter(source: ObserverSourceId, at: string) {
    const current = store.getAdapter(source)
    if (!current) {
      return
    }
    const health = rememberAdapterObservation(current.health, at)
    store.upsertAdapter({
      ...current,
      lastEventAt: at,
      installationStatus: health.status,
      enabled:
        current.source === 'git' || isEnabledInstallationStatus(health.status),
      health,
      updatedAt: at,
    })
  }

  function scanRepositoryInternal(repositoryId: string): void {
    if (disposed) {
      return
    }
    const repository = store.getRegisteredRepository(repositoryId)
    if (!repository) {
      throw new AppError('NOT_FOUND', 'Repositoryが見つかりません', 404)
    }
    const snapshot = snapshotGitRepository(repository.absolutePath)
    const now = nowIso()
    const worktreeViews = snapshot.worktrees.map((worktree) => {
      store.insertRepositorySnapshot({
        id: createObserverId(),
        repositoryId,
        worktreePath: worktree.path,
        branch: worktree.branch,
        headCommit: worktree.headCommit,
        baseCommit: worktree.baseCommit,
        status: {
          available: snapshot.available,
          isPrimary: worktree.isPrimary,
          changedFileCount: worktree.changedFileCount,
          storedFileCount: worktree.changedFiles.length,
          truncated: worktree.truncated,
        },
        changedFiles: worktree.changedFiles,
        createdAt: now,
      })
      if (worktree.changedFileCount > 0) {
        ensureGitSession(
          repositoryId,
          repository.workspaceId,
          worktree.path,
          worktree.branch,
          now,
        )
      }
      return worktree
    })
    refreshConflicts(
      store,
      repositoryId,
      worktreeViews.map((worktree) => ({
        path: worktree.path,
        branch: worktree.branch,
        headCommit: worktree.headCommit,
        baseCommit: worktree.baseCommit,
        files: worktree.changedFiles,
      })),
      now,
    )
    hub.publish({
      id: createObserverEventId(),
      type: 'observer.rescan',
      payload: { repositoryId },
      occurredAt: now,
    })
  }

  function activityFromStore(repositoryId: string): RepositoryActivityView {
    const repository = store.getRegisteredRepository(repositoryId)
    if (!repository) {
      throw new AppError('NOT_FOUND', 'Repositoryが見つかりません', 404)
    }
    const snapshot = latestSnapshotView(store, repositoryId)
    const sessions = store.listExternalSessions({ repositoryId })
    return buildRepositoryActivity({
      repository,
      snapshot,
      sessions,
      labels: Object.fromEntries(
        sessions
          .map(
            (session) =>
              [session.id, store.getSessionLabel(session.id)] as const,
          )
          .filter((entry) => entry[1]),
      ),
      conflicts: store.listConflicts({ repositoryId }),
      claims: store.listResourceClaims({ repositoryId }),
    })
  }

  service.ingestSpool()

  function reconcileRegisteredWatchers(): void {
    if (disposed) {
      return
    }
    try {
      watchers.reconcile(
        store.listRegisteredRepositories().map((repository) => ({
          repositoryId: repository.id,
          rootPath: repository.absolutePath,
        })),
      )
    } catch {
      // fail-soft: a watcher setup error must not hide repositories
    }
  }

  function rescanRegisteredRepositories(): void {
    if (disposed) {
      return
    }
    for (const repository of store.listRegisteredRepositories()) {
      try {
        scheduler.runIfDue(repository.id)
      } catch {
        // keep other repositories visible
      }
    }
  }

  function runConsistencyTick(): void {
    if (disposed) {
      return
    }
    try {
      service.ingestSpool()
    } catch {
      // one bounded sweep; remaining inbox waits for the next tick
    }
    try {
      rescanRegisteredRepositories()
    } catch {
      // throttled rescan is best-effort
    }
    reconcileRegisteredWatchers()
    if (disposed) {
      return
    }
    try {
      ingestLiveDiscovery()
    } catch {
      // live discovery is fail-open and never blocks hook or git observation
    }
    try {
      markStaleSessions(store)
    } catch {
      // stale marking must not keep a closed process alive
    }
  }

  function ingestLiveDiscovery(
    optionsForScan: { readonly force?: boolean } = {},
  ): void {
    if (disposed) {
      return
    }
    const now = options.now?.() ?? Date.now()
    if (
      !optionsForScan.force &&
      lastLiveScanAt > 0 &&
      now - lastLiveScanAt < OBSERVER_LIVE_SCAN_THROTTLE_MS
    ) {
      return
    }
    lastLiveScanAt = now
    const roots = collectLiveRoots()
    if (roots.length === 0) {
      return
    }
    let sightings: readonly LiveSighting[] = []
    try {
      const discover = options.discoverLive ?? discoverLiveSessions
      const listProcesses = resolveLiveProcessLister(options)
      sightings = discover({
        roots,
        homeDir: options.liveHomeDir ?? realUserHome(),
        currentUser: options.liveCurrentUser ?? userInfo().username,
        now,
        existingSessions: collectAdoptableLiveSessions(store),
        ...(listProcesses ? { listProcesses } : {}),
      })
    } catch {
      return
    }
    const repositories = store.listRegisteredRepositories()
    const discoveredWorktrees = Object.fromEntries(
      repositories.map((repository) => [
        repository.id,
        store
          .latestSnapshotsByRepository(repository.id)
          .map((snapshot) => snapshot.worktreePath),
      ]),
    )
    const touched = new Set<string>()
    for (const sighting of sightings) {
      try {
        const projected = liveSightingToEvent(sighting)
        upsertSessionFromEvent(
          store,
          projected,
          repositories,
          discoveredWorktrees,
        )
        touched.add(sighting.repositoryId)
      } catch {
        // one sighting must not hide the rest
      }
    }
    for (const repositoryId of touched) {
      hub.publish({
        id: createObserverEventId(),
        type: 'observer.rescan',
        payload: { repositoryId },
        occurredAt: nowIso(),
      })
    }
  }

  function collectLiveRoots() {
    const roots: Array<{
      repositoryId: string
      workspaceId: string
      absolutePath: string
    }> = []
    for (const repository of store.listRegisteredRepositories()) {
      roots.push({
        repositoryId: repository.id,
        workspaceId: repository.workspaceId,
        absolutePath: repository.absolutePath,
      })
      for (const snapshot of store.latestSnapshotsByRepository(repository.id)) {
        if (
          snapshot.worktreePath &&
          snapshot.worktreePath !== repository.absolutePath
        ) {
          roots.push({
            repositoryId: repository.id,
            workspaceId: repository.workspaceId,
            absolutePath: snapshot.worktreePath,
          })
        }
      }
    }
    return roots
  }

  if (consistencyIntervalMs > 0) {
    consistencyTimer = setIntervalFn(runConsistencyTick, consistencyIntervalMs)
    unrefTimer(consistencyTimer)
  }

  function syncRegisteredRepositoryCatalog(): void {
    syncRegisteredRepositoryCatalogFrom(store, dataDirectory)
  }

  function ensureGitSession(
    repositoryId: string,
    workspaceId: string,
    worktreePath: string,
    branch: string | null,
    now: string,
  ) {
    const existing = store.findExternalSession({
      source: 'git',
      repositoryId,
      worktreePath,
    })
    if (existing) {
      store.upsertExternalSession({
        ...existing,
        lastObservedAt: now,
        branch: branch ?? existing.branch,
        status: 'detected',
      })
      return
    }
    store.upsertExternalSession({
      id: createObserverId(),
      source: 'git',
      surface: 'unknown',
      externalSessionId: null,
      workspaceId,
      repositoryId,
      cwd: worktreePath,
      worktreePath,
      branch,
      baseCommit: null,
      headCommit: null,
      title: '変更元不明の作業',
      status: 'detected',
      activity: 'unknown',
      attributionConfidence: 'inferred',
      startedAt: now,
      lastObservedAt: now,
      endedAt: null,
    })
  }

  return service
}

function collectAdoptableLiveSessions(store: CombinedStore): Array<{
  readonly source: string
  readonly cwd: string | null
  readonly repositoryId: string | null
  readonly status: string
  readonly activity: string
}> {
  return store
    .listExternalSessions()
    .filter(
      (session) =>
        session.source !== 'git' &&
        Boolean(session.cwd ?? session.worktreePath) &&
        session.status !== 'completed' &&
        session.status !== 'ended' &&
        session.status !== 'failed' &&
        (session.status === 'waiting-for-user' ||
          session.activity === 'waiting-for-user' ||
          session.status === 'stale'),
    )
    .map((session) => ({
      source: session.source,
      cwd: session.cwd ?? session.worktreePath,
      repositoryId: session.repositoryId,
      status: session.status,
      activity: session.activity,
    }))
}

function resolveLiveProcessLister(
  options: ObserverServiceOptions,
): (() => readonly LiveProcessRow[]) | undefined {
  if (options.listLiveProcesses) {
    return options.listLiveProcesses
  }
  if (process.env.VITEST === 'true' && !options.discoverLive) {
    return () => []
  }
  return undefined
}

function alreadyProjected(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'schemaVersion' in raw &&
    raw.schemaVersion === 1 &&
    'idempotencyKey' in raw &&
    typeof raw.idempotencyKey === 'string'
  )
}

function shouldNormalizeWithAdapter(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) {
    return false
  }
  const record = raw as Record<string, unknown>
  if (typeof record.hook_event_name === 'string') {
    return true
  }
  if (record.source === 'claude-desktop' && !('schemaVersion' in record)) {
    return true
  }
  return typeof record.type === 'string' && !('schemaVersion' in record)
}

function syncRegisteredRepositoryCatalogFrom(
  store: CombinedStore,
  dataDirectory: string,
): void {
  writeRegisteredRepositoryCatalog(
    dataDirectory,
    store.listRegisteredRepositories().map((repository) => ({
      id: repository.id,
      displayName: repository.displayName,
      absolutePath: repository.absolutePath,
    })),
  )
}

function readSource(raw: unknown): ObserverSourceId | undefined {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'source' in raw &&
    typeof raw.source === 'string' &&
    isObserverSourceId(raw.source)
  ) {
    return raw.source
  }
  return undefined
}

function latestSnapshotView(
  store: CombinedStore,
  repositoryId: string,
): ReturnType<typeof snapshotGitRepository> {
  const latest = store.latestSnapshotsByRepository(repositoryId)
  if (latest.length === 0) {
    const repository = store.getRegisteredRepository(repositoryId)
    if (!repository) {
      return snapshotGitRepository('/dev/null')
    }
    return snapshotGitRepository(repository.absolutePath)
  }
  const root = latest[0]?.worktreePath ?? null
  const sync = root
    ? readSyncCounts(root)
    : { outgoingCount: null, incomingCount: null }
  return {
    available: true,
    reason: null,
    repositoryRoot: root,
    displayName:
      store.getRegisteredRepository(repositoryId)?.displayName ?? null,
    branch: latest.find((item) => item.worktreePath)?.branch ?? null,
    headCommit: latest[0]?.headCommit ?? null,
    baseCommit: latest[0]?.baseCommit ?? null,
    latestRecordTitle: root ? readLatestRecordTitle(root) : null,
    workStory: root
      ? readBlogWorkStory(root, {
          changedPaths: latest.flatMap((item) =>
            (item.changedFiles as ChangedFileRecord[]).map((file) => file.path),
          ),
        })
      : null,
    placeIntro: root ? readPlaceIntro(root) : null,
    articleTitles: root ? readBlogArticleTitles(root) : [],
    workTitles: root ? readRecentRecordTitles(root) : [],
    outgoingCount: sync.outgoingCount,
    incomingCount: sync.incomingCount,
    worktrees: latest.map((item, index) => {
      const files = item.changedFiles as ChangedFileRecord[]
      const status = item.status as {
        changedFileCount?: number
        truncated?: boolean
      }
      return {
        path: item.worktreePath,
        isPrimary: index === 0,
        branch: item.branch,
        headCommit: item.headCommit,
        baseCommit: item.baseCommit,
        changedFiles: files,
        changedFileCount: status.changedFileCount ?? files.length,
        truncated:
          status.truncated === true ||
          files.length < (status.changedFileCount ?? files.length),
      }
    }),
    changedFiles: latest.flatMap(
      (item) => item.changedFiles as ChangedFileRecord[],
    ),
    scannedAt: latest[0]?.createdAt ?? nowIso(),
    truncated: latest.some((item) => {
      const status = item.status as {
        truncated?: boolean
        changedFileCount?: number
      }
      return status.truncated === true
    }),
  }
}
