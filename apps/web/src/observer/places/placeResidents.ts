import type { GardenStationId, Workspace } from '@sikumi-local/core'
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
export const SHIKUMI_PLACE_NAME = 'しくみローカル番'

const ATLAS_COLUMNS = 3
const ATLAS_ROWS = 4
const QUIET_STATIONS = ['archive', 'rest', 'delivery'] as const

type OverviewRepository = TodayOverview['repositories'][number]
type OverviewSession = OverviewRepository['sessions'][number]

export type GardenPlaceStation = Exclude<GardenStationId, 'observatory'>
export type GardenPlaceTone = 'waiting' | 'working' | 'observing'

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

export type GardenPlaceActor = {
  readonly key: string
  readonly repositoryId: string
  readonly placeName: string
  readonly workSummary: string
  readonly station: GardenPlaceStation
  readonly tone: GardenPlaceTone
  readonly column: number
  readonly row: number
  readonly slot: number
  readonly jitterX: number
  readonly jitterY: number
}

export function mentionsShikumi(value: string): boolean {
  const normalized = value.toLowerCase()
  return normalized.includes('shikumi') || normalized.includes('sikumi')
}

export function deriveEmployeeName(repositoryName: string): string {
  const trimmed = repositoryName.trim()
  if (!trimmed) {
    return 'この場所番'
  }
  const normalized = trimmed.toLowerCase()
  if (mentionsShikumi(normalized)) return SHIKUMI_PLACE_NAME
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
  if (named && !mentionsShikumi(named)) {
    return named
  }
  return deriveEmployeeName(displayName || named || '')
}

export function collectPlaceResidents(
  overview: TodayOverview | null,
  workspaces: readonly Workspace[] = [],
): PlaceResident[] {
  const namesByWorkspace = new Map(
    workspaces.map((workspace) => [workspace.id, workspace.employeeName]),
  )
  const nowMs = parseOverviewNow(overview)
  const seenWorkspaceIds = new Set<string>()
  const fromOverview = (overview?.repositories ?? []).map((repository) => {
    seenWorkspaceIds.add(repository.workspaceId)
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
      lastObservedWork: describePlaceWork(observed, repository, nowMs),
      lastObservedLabel: latest?.lastObservedLabel ?? null,
    }
  })
  const extras = workspaces
    .filter((workspace) => !seenWorkspaceIds.has(workspace.id))
    .map((workspace) => ({
      repositoryId: workspace.repository.id,
      workspaceId: workspace.id,
      placeName: derivePlaceName(
        workspace.repository.displayName,
        workspace.employeeName,
      ),
      repositoryName: workspace.repository.displayName,
      working: false,
      waiting: false,
      lastObservedWork: UNKNOWN_PLACE_WORK,
      lastObservedLabel: null,
    }))
  return [...fromOverview, ...extras]
}

export function collectGardenActors(
  overview: TodayOverview | null,
  workspaces: readonly Workspace[] = [],
): GardenPlaceActor[] {
  const residents = collectPlaceResidents(overview, workspaces)
  const slotCursor = new Map<GardenPlaceStation, number>()
  return residents
    .map((resident) => {
      const hash = stableHash(resident.repositoryId)
      const tone: GardenPlaceTone = resident.waiting
        ? 'waiting'
        : resident.working
          ? 'working'
          : 'observing'
      return {
        key: resident.repositoryId,
        repositoryId: resident.repositoryId,
        placeName: resident.placeName,
        workSummary: resident.lastObservedWork,
        station: stationForResident(resident, hash),
        tone,
        column: hash % ATLAS_COLUMNS,
        row: (hash >>> 3) % ATLAS_ROWS,
        slot: 0,
        jitterX: ((hash % 7) - 3) * 0.18,
        jitterY: (((hash >>> 4) % 5) - 2) * 0.14,
      }
    })
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((actor) => {
      const slot = slotCursor.get(actor.station) ?? 0
      slotCursor.set(actor.station, slot + 1)
      return { ...actor, slot }
    })
}

export function stationForResident(
  resident: Pick<PlaceResident, 'waiting' | 'working' | 'repositoryId'>,
  hash = stableHash(resident.repositoryId),
): GardenPlaceStation {
  if (resident.waiting) return 'waiting'
  if (resident.working) return 'workbench'
  return QUIET_STATIONS[hash % QUIET_STATIONS.length] ?? 'rest'
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
  nowMs: number,
): string {
  const current = sessions.filter((session) => {
    const tone = resolveTone(session.status, session.activity)
    return tone === 'waiting' || shouldShowGardenDog(session, nowMs)
  })
  const ranked = [...current].sort(compareObservedAt)
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

function stableHash(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
