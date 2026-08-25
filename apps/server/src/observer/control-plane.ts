import {
  clipList,
  OBSERVER_UI_MAX_REPOSITORIES,
  type ConflictFinding,
  type ControlPlaneSnapshot,
  type ExternalSession,
  type NormalizedObserverEvent,
  type ObserverAdapterRecord,
  type ObserverHealthSnapshot,
  type Recommendation,
  type RepositorySituation,
  type ResourceClaim,
} from '@sikumi-local/observer-core'
import { buildAttentionItems } from './attention.js'
import {
  buildObservedWorks,
  type SituationGitInput,
} from './situation.js'

export interface ControlPlaneInput {
  readonly repositories: readonly {
    readonly id: string
    readonly displayName: string
    readonly available?: boolean
  }[]
  readonly sessions: readonly ExternalSession[]
  readonly events?: readonly NormalizedObserverEvent[]
  readonly claims?: readonly ResourceClaim[]
  readonly conflicts?: readonly ConflictFinding[]
  readonly adapters?: readonly ObserverAdapterRecord[]
  readonly git?: readonly SituationGitInput[]
  readonly now?: number
  readonly generatedAt?: string
}

export function buildControlPlaneSnapshot(
  input: ControlPlaneInput,
): ControlPlaneSnapshot {
  const now = input.now ?? Date.now()
  const git = input.git ?? []
  const works = buildObservedWorks({
    sessions: input.sessions,
    events: input.events ?? [],
    claims: input.claims ?? [],
    git,
    now,
  })
  const attention = buildAttentionItems({
    works,
    sessions: input.sessions,
    claims: input.claims ?? [],
    conflicts: input.conflicts ?? [],
    adapters: input.adapters ?? [],
    git,
    now,
  })
  const recommendations: Recommendation[] = []
  const gitByRepo = new Map(git.map((item) => [item.repositoryId, item]))
  const repositories = clipList(
    input.repositories.map((repository) => {
      const repoWorks = works.filter((work) => work.repositoryId === repository.id)
      const repoAttention = attention.filter(
        (item) => item.repositoryId === repository.id,
      )
      const snapshot = gitByRepo.get(repository.id)
      return {
        repositoryId: repository.id,
        displayName: repository.displayName,
        available: snapshot?.available ?? repository.available ?? true,
        works: repoWorks,
        attention: repoAttention,
        waitingCount: repoAttention.filter((item) => item.kind === 'waiting-for-user')
          .length,
        staleCount: repoAttention.filter((item) => item.kind === 'stale-work').length,
        conflictCount: repoAttention.filter((item) => item.kind === 'conflict').length,
      } satisfies RepositorySituation
    }),
    OBSERVER_UI_MAX_REPOSITORIES,
  )

  return {
    generatedAt: input.generatedAt ?? new Date(now).toISOString(),
    works,
    attention,
    recommendations,
    repositories: repositories.items,
    observer: observerHealth(input.adapters ?? []),
  }
}

function observerHealth(
  adapters: readonly ObserverAdapterRecord[],
): ObserverHealthSnapshot {
  const watched = adapters.filter((adapter) => adapter.source !== 'git')
  const degraded = watched.filter(
    (adapter) =>
      adapter.installationStatus === 'degraded' ||
      adapter.health.status === 'degraded',
  )
  return {
    ok: degraded.length === 0,
    degradedCount: degraded.length,
    adapters: adapters.map((adapter) => ({
      source: adapter.source,
      status: adapter.installationStatus,
      lastEventAt: adapter.lastEventAt,
    })),
  }
}
