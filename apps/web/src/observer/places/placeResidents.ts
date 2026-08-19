import type { Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import {
  describeGardenWork,
  isGenericWorkTitle,
  knownSourceLabel,
  resolveTone,
  shouldShowGardenDog,
  sourceKey,
  UNKNOWN_GARDEN_WORK,
} from '../garden/gardenState'

export const UNKNOWN_PLACE_WORK = 'まだ分かっていません'

type OverviewRepository = TodayOverview['repositories'][number]
type OverviewSession = OverviewRepository['sessions'][number]

export type PlaceResident = {
  readonly repositoryId: string
  readonly workspaceId: string
  readonly placeName: string
  readonly repositoryName: string
  readonly working: boolean
  readonly waiting: boolean
  readonly lastObservedWork: string
  readonly lastObservedLabel: string | null
}

export function deriveEmployeeName(repositoryName: string): string {
  const trimmed = repositoryName.trim()
  if (!trimmed) {
    return 'この場所番'
  }
  const normalized = trimmed.toLowerCase()
  if (normalized.includes('blog')) return 'ブログ番'
  if (normalized.includes('content')) return 'コンテンツ番'
  if (normalized.includes('web')) return 'ウェブ番'
  if (normalized.includes('app')) return 'アプリ番'
  if (normalized === 'project') return 'プロジェクト番'
  return `${trimmed.slice(0, 36)}番`
}

export function derivePlaceName(
  displayName: string,
  employeeName?: string | null,
): string {
  const named = employeeName?.trim()
  if (named) {
    return named
  }
  return deriveEmployeeName(displayName)
}

export function collectPlaceResidents(
  overview: TodayOverview | null,
  workspaces: readonly Workspace[] = [],
): PlaceResident[] {
  const namesByWorkspace = new Map(
    workspaces.map((workspace) => [workspace.id, workspace.employeeName]),
  )
  const nowMs = parseOverviewNow(overview)
  return (overview?.repositories ?? []).map((repository) => {
    const observed = (repository.sessions ?? []).filter(
      (session) =>
        sourceKey(session.source) !== 'git' &&
        session.attributionConfidence !== 'inferred',
    )
    const latest = latestSession(repository.sessions ?? [])
    return {
      repositoryId: repository.repositoryId,
      workspaceId: repository.workspaceId,
      placeName: derivePlaceName(
        repository.displayName,
        namesByWorkspace.get(repository.workspaceId),
      ),
      repositoryName: repository.displayName,
      working: observed.some((session) => {
        if (!shouldShowGardenDog(session, nowMs)) {
          return false
        }
        return resolveTone(session.status, session.activity) === 'working'
      }),
      waiting: observed.some(
        (session) =>
          resolveTone(session.status, session.activity) === 'waiting',
      ),
      lastObservedWork: describePlaceWork(observed, repository),
      lastObservedLabel: latest?.lastObservedLabel ?? null,
    }
  })
}

export function placeActivityLabel(resident: PlaceResident): string {
  if (resident.waiting && resident.working) {
    return '動いている / 確認待ち'
  }
  if (resident.waiting) {
    return '確認待ち'
  }
  if (resident.working) {
    return '動いている'
  }
  return '静か'
}

function describePlaceWork(
  sessions: readonly OverviewSession[],
  repository: OverviewRepository,
): string {
  const ranked = [...sessions].sort(compareObservedAt)
  for (const session of ranked) {
    const title = session.title?.trim()
    if (title && !isGenericWorkTitle(title)) {
      return title
    }
    const named = session.displayName?.trim()
    const sourceLabel = knownSourceLabel(session.source)
    if (
      named &&
      !isGenericWorkTitle(named) &&
      named !== sourceLabel &&
      named.toLowerCase() !== sourceKey(session.source)
    ) {
      return named
    }
  }
  const latest = ranked[0]
  if (latest) {
    const described = describeGardenWork(latest, repository)
    if (
      described !== UNKNOWN_GARDEN_WORK &&
      !described.endsWith('が対象です')
    ) {
      return described
    }
  }
  return UNKNOWN_PLACE_WORK
}

function latestSession(
  sessions: readonly OverviewSession[],
): OverviewSession | undefined {
  return [...sessions].sort(compareObservedAt)[0]
}

function compareObservedAt(left: OverviewSession, right: OverviewSession) {
  return Date.parse(right.lastObservedAt) - Date.parse(left.lastObservedAt)
}

function parseOverviewNow(overview: TodayOverview | null): number {
  const parsed = overview?.generatedAt ? Date.parse(overview.generatedAt) : NaN
  return Number.isNaN(parsed) ? Date.now() : parsed
}
