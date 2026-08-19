import type { GardenStationId, Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import {
  canNameObservedDriver,
  describeGardenWork,
  isGenericWorkTitle,
  knownSourceLabel,
  resolveTone,
  shouldShowGardenDog,
  sourceKey,
  UNKNOWN_GARDEN_WORK,
} from '../garden/gardenState'

export const SHIKUMI_PLACE_NAME = 'しくみローカル番'

const ATLAS_COLUMNS = 3
const ATLAS_ROWS = 4
const QUIET_STATIONS = ['rest', 'delivery'] as const

export const GARDEN_GROUND = {
  minX: 36,
  maxX: 84,
  minY: 34,
  maxY: 64,
} as const

const WORKBENCH_POINT = { x: 49, y: 38 }
const WAITING_POINT = { x: 78, y: 44 }
const REST_POINT = { x: 53, y: 49 }
const DELIVERY_POINT = { x: 69, y: 27 }
const GROUND_Y_WAVE = [0, 8, -5, 10, 3, -7, 5] as const

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
  readonly lastObservedWorkLabel: string | null
  readonly lastChangedAt: string | null
  readonly lastObservedAt: string | null
  readonly changedFileCount: number
  readonly areas: readonly string[]
  readonly conflictCount: number
  readonly driverNote: string | null
}

export type PlaceInspectCopy = {
  readonly nowText: string
  readonly implementationLook: string
  readonly nextStep: string
  readonly driverNote: string | null
}

export type GardenPlaceActor = {
  readonly key: string
  readonly repositoryId: string
  readonly placeName: string
  readonly repositoryName: string
  readonly workSummary: string
  readonly nowText: string
  readonly implementationLook: string
  readonly nextStep: string
  readonly driverNote: string | null
  readonly station: GardenPlaceStation
  readonly tone: GardenPlaceTone
  readonly groundX: number
  readonly groundY: number
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
    const latestObserved = latestSession(observed)
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
      lastObservedWorkLabel: latestObserved?.lastObservedLabel ?? null,
      lastChangedAt: repository.lastChangedAt ?? null,
      lastObservedAt: latest?.lastObservedAt ?? null,
      changedFileCount: repository.changedFileCount,
      areas: lookAreas(repository),
      conflictCount: repository.conflicts.length,
      driverNote: describeObservedDriver(observed, nowMs),
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
      lastObservedWork: '',
      lastObservedLabel: null,
      lastObservedWorkLabel: null,
      lastChangedAt: workspace.updatedAt,
      lastObservedAt: workspace.updatedAt,
      changedFileCount: 0,
      areas: [],
      conflictCount: 0,
      driverNote: null,
    }))
  return [...fromOverview, ...extras]
}

export function collectGardenActors(
  overview: TodayOverview | null,
  workspaces: readonly Workspace[] = [],
): GardenPlaceActor[] {
  const residents = collectPlaceResidents(overview, workspaces)
  const plots = assignGardenGroundPlots(residents)
  return residents
    .map((resident) => {
      const hash = stableHash(resident.repositoryId)
      const tone: GardenPlaceTone = resident.waiting
        ? 'waiting'
        : resident.working
          ? 'working'
          : 'observing'
      const inspect = describePlaceInspect(resident)
      const plot = plots.get(resident.repositoryId)
      return {
        key: resident.repositoryId,
        repositoryId: resident.repositoryId,
        placeName: resident.placeName,
        repositoryName: resident.repositoryName,
        workSummary: describeKnownWork(resident),
        nowText: inspect.nowText,
        implementationLook: inspect.implementationLook,
        nextStep: inspect.nextStep,
        driverNote: inspect.driverNote,
        station: plot?.station ?? stationForResident(resident),
        tone,
        groundX: plot?.x ?? REST_POINT.x,
        groundY: plot?.y ?? REST_POINT.y,
        column: hash % ATLAS_COLUMNS,
        row: (hash >>> 3) % ATLAS_ROWS,
        slot: plot?.slot ?? 0,
        jitterX: ((hash % 7) - 3) * 0.18,
        jitterY: (((hash >>> 4) % 5) - 2) * 0.14,
      }
    })
    .sort((left, right) => left.key.localeCompare(right.key))
}

export function stationForResident(
  resident: Pick<PlaceResident, 'waiting' | 'working' | 'repositoryId'>,
  hash = stableHash(resident.repositoryId),
): GardenPlaceStation {
  if (resident.waiting) return 'waiting'
  if (resident.working) return 'workbench'
  return QUIET_STATIONS[hash % QUIET_STATIONS.length] ?? 'rest'
}

export function assignGardenGroundPlots(
  residents: readonly Pick<
    PlaceResident,
    'repositoryId' | 'waiting' | 'working'
  >[],
): ReadonlyMap<
  string,
  {
    readonly x: number
    readonly y: number
    readonly station: GardenPlaceStation
    readonly slot: number
  }
> {
  const plots = spreadGardenGroundPlots(residents.length)
  const unused = plots.map((_, index) => index)
  const assigned = new Map<
    string,
    {
      readonly x: number
      readonly y: number
      readonly station: GardenPlaceStation
      readonly slot: number
    }
  >()
  const ordered = [...residents].sort((left, right) =>
    left.repositoryId.localeCompare(right.repositoryId),
  )

  function takeClosest(target: { readonly x: number; readonly y: number }) {
    let bestUnused = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < unused.length; index += 1) {
      const plot = plots[unused[index]!]
      if (!plot) continue
      const distance = (plot.x - target.x) ** 2 + (plot.y - target.y) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        bestUnused = index
      }
    }
    const plotIndex = unused.splice(bestUnused, 1)[0] ?? 0
    return { plot: plots[plotIndex] ?? REST_POINT, slot: plotIndex }
  }

  for (const resident of ordered.filter((item) => item.waiting)) {
    const { plot, slot } = takeClosest(WAITING_POINT)
    assigned.set(resident.repositoryId, {
      x: plot.x,
      y: plot.y,
      station: 'waiting',
      slot,
    })
  }
  for (const resident of ordered.filter(
    (item) => !item.waiting && item.working,
  )) {
    const { plot, slot } = takeClosest(WORKBENCH_POINT)
    assigned.set(resident.repositoryId, {
      x: plot.x,
      y: plot.y,
      station: 'workbench',
      slot,
    })
  }
  for (const resident of ordered.filter(
    (item) => !item.waiting && !item.working,
  )) {
    const plotIndex = unused.shift() ?? 0
    const plot = plots[plotIndex] ?? REST_POINT
    assigned.set(resident.repositoryId, {
      x: plot.x,
      y: plot.y,
      station: quietStationForPlot(plot),
      slot: plotIndex,
    })
  }
  return assigned
}

export function spreadGardenGroundPlots(
  count: number,
): readonly { readonly x: number; readonly y: number }[] {
  if (count <= 0) {
    return []
  }
  if (count === 1) {
    return [{ x: 58, y: 50 }]
  }
  const span = GARDEN_GROUND.maxX - GARDEN_GROUND.minX
  return Array.from({ length: count }, (_, index) => {
    const x = GARDEN_GROUND.minX + (span * index) / (count - 1)
    const waved = 48 + GROUND_Y_WAVE[index % GROUND_Y_WAVE.length]!
    return {
      x,
      y: clamp(waved, GARDEN_GROUND.minY, GARDEN_GROUND.maxY),
    }
  })
}

function quietStationForPlot(plot: {
  readonly x: number
  readonly y: number
}): GardenPlaceStation {
  const restDistance =
    (plot.x - REST_POINT.x) ** 2 + (plot.y - REST_POINT.y) ** 2
  const deliveryDistance =
    (plot.x - DELIVERY_POINT.x) ** 2 + (plot.y - DELIVERY_POINT.y) ** 2
  return restDistance <= deliveryDistance ? 'rest' : 'delivery'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function sortPlaceResidents(
  residents: readonly PlaceResident[],
): PlaceResident[] {
  return [...residents].sort((left, right) => {
    const leftLive = left.working || left.waiting
    const rightLive = right.working || right.waiting
    if (leftLive !== rightLive) {
      return leftLive ? -1 : 1
    }
    const recency = residentRecency(right) - residentRecency(left)
    if (recency !== 0) {
      return recency
    }
    return left.placeName.localeCompare(right.placeName, 'ja')
  })
}

function residentRecency(resident: PlaceResident): number {
  return Math.max(
    parseTime(resident.lastChangedAt),
    parseTime(resident.lastObservedAt),
  )
}

function parseTime(value: string | null): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
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

export function describePlaceInspect(
  resident: PlaceResident,
): PlaceInspectCopy {
  const activity = placeActivityLabel(resident)
  const work = resident.lastObservedWork.trim()
  const whenLabel = resident.lastObservedWorkLabel ?? resident.lastObservedLabel
  const when = whenLabel ? `（${whenLabel}）` : ''
  return {
    nowText: work ? `${activity}。${work}${when}` : `${activity}${when}`,
    implementationLook: describeImplementationLook(resident),
    nextStep: describeNextStep(resident),
    driverNote: resident.driverNote,
  }
}

export function describeKnownWork(resident: PlaceResident): string {
  const job = resident.lastObservedWork.trim()
  if (job) {
    return job
  }
  const files = describeImplementationLook(resident)
  if (files) {
    return files
  }
  return placeActivityLabel(resident)
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
  return ''
}

export function describeImplementationLook(resident: PlaceResident): string {
  const count = resident.changedFileCount
  const named = uniqueLabels(resident.areas).filter(
    (area) => area !== '作業中のファイル',
  )
  const shown = named.slice(0, 2)
  if (count <= 0 && shown.length === 0) {
    return ''
  }
  const filesPhrase =
    count === 1
      ? '作業中のファイルが1つある'
      : `作業中のファイルが${count}件ある`
  if (count <= 0) {
    return shown.length === 1
      ? `${shown[0]}あたりの様子が見えています`
      : `${shown[0]}や${shown[1]}あたりの様子が見えています`
  }
  if (shown.length === 0) {
    return filesPhrase
  }
  if (shown.length === 1) {
    return `${filesPhrase}。${shown[0]}あたりです`
  }
  return `${filesPhrase}。${shown[0]}や${shown[1]}あたりです`
}

function describeNextStep(
  resident: Pick<PlaceResident, 'waiting' | 'working' | 'conflictCount'>,
): string {
  if (resident.waiting || resident.conflictCount > 0) {
    return '確認が必要'
  }
  if (resident.working) {
    return 'いまの作業の続き'
  }
  return '次に動かすまで待つ'
}

function lookAreas(repository: OverviewRepository): string[] {
  if (repository.areas.length > 0) {
    return uniqueLabels(repository.areas)
  }
  const fromFiles: string[] = []
  for (const worktree of repository.worktrees) {
    for (const file of worktree.files) {
      const label = file.areaLabel.trim()
      if (label) {
        fromFiles.push(label)
      }
    }
  }
  return uniqueLabels(fromFiles)
}

function describeObservedDriver(
  sessions: readonly OverviewSession[],
  nowMs: number,
): string | null {
  const labels: string[] = []
  for (const session of sessions) {
    if (!canNameObservedDriver(session, nowMs)) {
      continue
    }
    const label = knownSourceLabel(session.source)
    if (label && !labels.includes(label)) {
      labels.push(label)
    }
  }
  if (labels.length === 0) {
    return null
  }
  if (labels.length === 1) {
    return `${labels[0]}が動かしている`
  }
  if (labels.length === 2) {
    return `${labels[0]}と${labels[1]}が動かしている`
  }
  return `${labels[0]}と${labels[1]}などが動かしている`
}

function uniqueLabels(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    labels.push(trimmed)
  }
  return labels
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
