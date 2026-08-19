import type { GardenStationId, Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import {
  describeGardenWork,
  isEverydayRecordTitle,
  isGenericWorkTitle,
  isSpokenJapaneseTitle,
  knownSourceLabel,
  resolveTone,
  shouldShowGardenDog,
  softenRecordTitle,
  sourceKey,
  UNKNOWN_GARDEN_WORK,
} from '../garden/gardenState'
import { walkLaneOffset, WORKING_WALK_LANE_X } from '../garden/gardenWalk'

const MAX_VISIBLE_WORK_TITLES = 12

export const UNKNOWN_PLACE_WORK = 'まだ分かっていません'
export const SHIKUMI_PLACE_NAME = 'しくみローカル番'
const CONFIRMED_TOOL_SURFACES = new Set([
  'desktop-app',
  'ide',
  'cursor-agent',
  'cursor-cli',
])

const ATLAS_COLUMNS = 3
const ATLAS_ROWS = 4
const QUIET_STATIONS = ['rest', 'delivery'] as const
const GENERIC_AREA_LABEL = '作業中のファイル'
const BUBBLE_AREA_SHORT: Readonly<Record<string, string>> = {
  確認用の仕組み: '確認',
  道具の一覧: '道具',
  ユーザー情報: 'ユーザー',
  ログイン状態: 'ログイン',
  データの形: 'データ',
  別作業場: '別の場所',
}
const EVERYDAY_INSPECT_AREAS: Readonly<Record<string, string>> = {
  画面: '画面',
  確認: '確認',
  確認用の仕組み: '確認',
  道具: '道具',
  道具の一覧: '道具',
  ユーザー: 'ユーザー',
  ユーザー情報: 'ユーザー',
  ログイン: 'ログイン',
  ログイン状態: 'ログイン',
}

const LEFTOVER_KIND_AREAS: Readonly<Record<string, string>> = {
  画面: '画面',
  確認: '確認の仕組み',
  確認用の仕組み: '確認の仕組み',
  道具: '道具',
  道具の一覧: '道具',
  ユーザー: 'ユーザー',
  ユーザー情報: 'ユーザー',
  ログイン: 'ログイン',
  ログイン状態: 'ログイン',
  記事: '記事',
}

const BUBBLE_GOAL_MAX = 36

export const LEFTOVER_WORK_REMAINING = '途中の仕事が残っている'
export const ANOTHER_LIVE_WORK = 'もう一つの仕事が動いている'

const HOOK_LEFTOVER_TITLE_PATTERNS = [
  /の作業が始まりました$/,
  /の作業が終わりました$/,
  /の様子が届きました$/,
  /が確認を待っています$/,
  /がファイルを扱っています$/,
  /が道具を使っています$/,
  /のサブエージェントが始まりました$/,
]

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
  readonly latestRecordTitle: string | null
  readonly workStory: string | null
  readonly articleTitles: readonly {
    readonly title: string
    readonly date: string | null
  }[]
  readonly workTitles: readonly string[]
  readonly goal: string | null
  readonly outgoingCount: number | null
  readonly incomingCount: number | null
  readonly driverNote: string | null
}

export type PlaceInspectCopy = {
  readonly nowText: string | null
  readonly implementationLook: string | null
  readonly nextStep: string | null
  readonly driverNote: string | null
  readonly goal: string | null
  readonly articleTitles: readonly {
    readonly title: string
    readonly date: string | null
  }[]
  readonly workTitles: readonly string[]
}

type GardenActorSource = PlaceResident & {
  readonly key: string
  readonly streamIndex: number
}

export type GardenPlaceActor = {
  readonly key: string
  readonly repositoryId: string
  readonly placeName: string
  readonly repositoryName: string
  readonly workSummary: string
  readonly nowText: string | null
  readonly implementationLook: string | null
  readonly nextStep: string | null
  readonly driverNote: string | null
  readonly goal: string | null
  readonly articleTitles: readonly {
    readonly title: string
    readonly date: string | null
  }[]
  readonly workTitles: readonly string[]
  readonly station: GardenPlaceStation
  readonly tone: GardenPlaceTone
  readonly groundX: number
  readonly groundY: number
  readonly column: number
  readonly row: number
  readonly slot: number
  readonly jitterX: number
  readonly jitterY: number
  readonly streamIndex: number
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
      waiting: observed.some((session) => {
        if (!shouldShowGardenDog(session, nowMs)) {
          return false
        }
        return resolveTone(session.status, session.activity) === 'waiting'
      }),
      lastObservedWork: describePlaceWork(observed, repository, nowMs),
      lastObservedLabel: latest?.lastObservedLabel ?? null,
      lastObservedWorkLabel: latestObserved?.lastObservedLabel ?? null,
      lastChangedAt: repository.lastChangedAt ?? null,
      lastObservedAt: latest?.lastObservedAt ?? null,
      changedFileCount: repository.changedFileCount,
      areas: lookAreas(repository),
      conflictCount: repository.conflicts.length,
      latestRecordTitle: everydayRecordTitle(repository.latestRecordTitle),
      workStory: everydayWorkStory(repository.workStory),
      articleTitles: everydayArticleTitles(repository.articleTitles),
      workTitles: collectSpokenWorkTitles(repository),
      goal: pickResidentGoal(observed, nowMs),
      outgoingCount: repository.outgoingCount ?? null,
      incomingCount: repository.incomingCount ?? null,
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
      latestRecordTitle: null,
      workStory: null,
      articleTitles: [],
      workTitles: [],
      goal: null,
      outgoingCount: null,
      incomingCount: null,
      driverNote: null,
    }))
  return [...fromOverview, ...extras]
}

function gardenPlotKey(resident: {
  readonly repositoryId: string
  readonly key?: string
}): string {
  return resident.key ?? resident.repositoryId
}

export function isParallelLiveWorkStream(
  session: OverviewSession,
  nowMs: number,
): boolean {
  if (!shouldShowGardenDog(session, nowMs)) {
    return false
  }
  const title = session.title?.trim() ?? ''
  if (isHookLeftoverTitle(title)) {
    return false
  }
  if (isGenericWorkTitle(title) && !isConfirmedTool(session)) {
    return false
  }
  return true
}

function isHookLeftoverTitle(title: string): boolean {
  return HOOK_LEFTOVER_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

function expandGardenActorSources(
  residents: readonly PlaceResident[],
  overview: TodayOverview | null,
): GardenActorSource[] {
  const nowMs = parseOverviewNow(overview)
  const repositories = new Map(
    (overview?.repositories ?? []).map((repository) => [
      repository.repositoryId,
      repository,
    ]),
  )
  const sources: GardenActorSource[] = []
  for (const resident of residents) {
    const streams = parallelLiveStreams(
      repositories.get(resident.repositoryId)?.sessions ?? [],
      nowMs,
    )
    if (streams.length <= 1) {
      sources.push({
        ...resident,
        key: resident.repositoryId,
        streamIndex: 0,
      })
      continue
    }
    const drafts = streams.map((session, streamIndex) =>
      residentForLiveStream(resident, session, streamIndex, nowMs),
    )
    const summaries = drafts.map((draft) => describeVisibleFacts(draft))
    const needDisambiguate = new Set(summaries).size < summaries.length
    for (const [streamIndex, draft] of drafts.entries()) {
      sources.push({
        ...draft,
        placeName: needDisambiguate
          ? disambiguatedPlaceName(resident.placeName, streamIndex)
          : resident.placeName,
      })
    }
  }
  return sources
}

function parallelLiveStreams(
  sessions: readonly OverviewSession[],
  nowMs: number,
): OverviewSession[] {
  return sessions
    .filter((session) => isParallelLiveWorkStream(session, nowMs))
    .sort(compareObservedAt)
}

function residentForLiveStream(
  resident: PlaceResident,
  session: OverviewSession,
  streamIndex: number,
  nowMs: number,
): GardenActorSource {
  const tone = resolveTone(session.status, session.activity)
  const spoken = streamSpokenTitle(session)
  const primary = streamIndex === 0
  return {
    ...resident,
    key: `${resident.repositoryId}:${session.id}`,
    working: tone === 'working',
    waiting: tone === 'waiting',
    lastObservedWork: spoken ?? (primary ? '' : ANOTHER_LIVE_WORK),
    lastObservedLabel: session.lastObservedLabel,
    lastObservedWorkLabel: session.lastObservedLabel,
    lastObservedAt: session.lastObservedAt,
    workStory: primary ? resident.workStory : null,
    articleTitles: primary ? resident.articleTitles : [],
    workTitles: primary ? resident.workTitles : [],
    goal: sessionGoal(session) ?? (primary ? resident.goal : null),
    changedFileCount: primary ? resident.changedFileCount : 0,
    outgoingCount: primary ? resident.outgoingCount : null,
    incomingCount: primary ? resident.incomingCount : null,
    areas: primary ? resident.areas : [],
    latestRecordTitle: primary ? resident.latestRecordTitle : null,
    driverNote: describeObservedDriver([session], nowMs),
    streamIndex,
  }
}

function streamSpokenTitle(session: OverviewSession): string | null {
  const title = spokenRecordTitle(session.title)
  if (title) {
    return title
  }
  const named = spokenRecordTitle(session.displayName)
  const sourceLabel = knownSourceLabel(session.source)
  if (
    named &&
    named !== sourceLabel &&
    named.toLowerCase() !== sourceKey(session.source)
  ) {
    return named
  }
  return null
}

function disambiguatedPlaceName(
  placeName: string,
  streamIndex: number,
): string {
  if (streamIndex === 0) {
    return placeName
  }
  const base = placeName.replace(/番$/, '').trim() || placeName
  return `${base} ${streamIndex + 1}`
}

export function collectGardenActors(
  overview: TodayOverview | null,
  workspaces: readonly Workspace[] = [],
): GardenPlaceActor[] {
  const sources = expandGardenActorSources(
    collectPlaceResidents(overview, workspaces),
    overview,
  )
  const plots = assignGardenGroundPlots(sources)
  return separateCrowdedGardenActors(
    sources.map((source) => {
      const hash = stableHash(source.key)
      const tone: GardenPlaceTone = source.waiting
        ? 'waiting'
        : source.working
          ? 'working'
          : 'observing'
      const inspect = describePlaceInspect(source)
      const plot = plots.get(gardenPlotKey(source))
      const slot = plot?.slot ?? 0
      const lane =
        source.streamIndex > 0
          ? walkLaneOffset({
              streamIndex: source.streamIndex,
              slot,
            })
          : { x: 0, y: 0 }
      return {
        key: source.key,
        repositoryId: source.repositoryId,
        placeName: source.placeName,
        repositoryName: source.repositoryName,
        workSummary: describeVisibleFacts(source),
        nowText: inspect.nowText,
        implementationLook: inspect.implementationLook,
        nextStep: inspect.nextStep,
        driverNote: inspect.driverNote,
        goal: inspect.goal,
        articleTitles: inspect.articleTitles,
        workTitles: inspect.workTitles,
        station: plot?.station ?? stationForResident(source),
        tone,
        groundX: clamp(
          (plot?.x ?? REST_POINT.x) + lane.x,
          GARDEN_GROUND.minX,
          GARDEN_GROUND.maxX,
        ),
        groundY: clamp(
          (plot?.y ?? REST_POINT.y) + lane.y,
          GARDEN_GROUND.minY,
          GARDEN_GROUND.maxY,
        ),
        column: hash % ATLAS_COLUMNS,
        row: (hash >>> 3) % ATLAS_ROWS,
        slot,
        jitterX: ((hash % 7) - 3) * 0.18,
        jitterY: (((hash >>> 4) % 5) - 2) * 0.14,
        streamIndex: source.streamIndex,
      }
    }),
  ).sort((left, right) => left.key.localeCompare(right.key))
}

function separateCrowdedGardenActors(
  actors: readonly GardenPlaceActor[],
): GardenPlaceActor[] {
  const next = [...actors]
  const indexesByPlace = new Map<string, number[]>()
  const working: number[] = []
  next.forEach((actor, index) => {
    const indexes = indexesByPlace.get(actor.repositoryId) ?? []
    indexes.push(index)
    indexesByPlace.set(actor.repositoryId, indexes)
    if (actor.tone === 'working') {
      working.push(index)
    }
  })
  for (const indexes of indexesByPlace.values()) {
    separateActorsAlongX(next, indexes)
  }
  separateActorsAlongX(next, working)
  return next
}

function separateActorsAlongX(
  actors: GardenPlaceActor[],
  indexes: readonly number[],
): void {
  if (indexes.length < 2) {
    return
  }
  const ordered = [...indexes].sort((left, right) => {
    if (actors[left]!.slot !== actors[right]!.slot) {
      return actors[left]!.slot - actors[right]!.slot
    }
    return actors[left]!.groundX - actors[right]!.groundX
  })
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = actors[ordered[index - 1]!]!
    const current = actors[ordered[index]!]!
    const gap = current.groundX - previous.groundX
    if (Math.abs(gap) >= WORKING_WALK_LANE_X) {
      continue
    }
    const direction = gap >= 0 ? 1 : -1
    const pushed = clamp(
      previous.groundX + direction * WORKING_WALK_LANE_X,
      GARDEN_GROUND.minX,
      GARDEN_GROUND.maxX,
    )
    actors[ordered[index]!] = { ...current, groundX: pushed }
    const still = actors[ordered[index]!]!
    if (Math.abs(still.groundX - previous.groundX) >= WORKING_WALK_LANE_X) {
      continue
    }
    actors[ordered[index - 1]!] = {
      ...previous,
      groundX: clamp(
        still.groundX - direction * WORKING_WALK_LANE_X,
        GARDEN_GROUND.minX,
        GARDEN_GROUND.maxX,
      ),
    }
  }
}

export function hasUnfinishedGardenWork(
  resident:
    | Pick<PlaceResident, 'changedFileCount' | 'outgoingCount'>
    | {
        readonly changedFileCount?: number
        readonly outgoingCount?: number | null
      },
): boolean {
  return (
    (resident.changedFileCount ?? 0) > 0 || (resident.outgoingCount ?? 0) > 0
  )
}

export function stationForResident(
  resident: Pick<PlaceResident, 'waiting' | 'working' | 'repositoryId'> &
    Partial<Pick<PlaceResident, 'changedFileCount' | 'outgoingCount'>> & {
      readonly key?: string
    },
  hash = stableHash(gardenPlotKey(resident)),
): GardenPlaceStation {
  if (resident.waiting) return 'waiting'
  if (resident.working) return 'workbench'
  if (hasUnfinishedGardenWork(resident)) return 'rest'
  return QUIET_STATIONS[hash % QUIET_STATIONS.length] ?? 'rest'
}

export function assignGardenGroundPlots(
  residents: readonly (Pick<
    PlaceResident,
    'repositoryId' | 'waiting' | 'working'
  > &
    Partial<Pick<PlaceResident, 'changedFileCount' | 'outgoingCount'>> & {
      readonly key?: string
    })[],
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
    gardenPlotKey(left).localeCompare(gardenPlotKey(right)),
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
    assigned.set(gardenPlotKey(resident), {
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
    assigned.set(gardenPlotKey(resident), {
      x: plot.x,
      y: plot.y,
      station: 'workbench',
      slot,
    })
  }
  for (const resident of ordered.filter(
    (item) => !item.waiting && !item.working && hasUnfinishedGardenWork(item),
  )) {
    const { plot, slot } = takeClosest(REST_POINT)
    assigned.set(gardenPlotKey(resident), {
      x: plot.x,
      y: plot.y,
      station: unfinishedQuietStationForPlot(plot),
      slot,
    })
  }
  for (const resident of ordered.filter(
    (item) => !item.waiting && !item.working && !hasUnfinishedGardenWork(item),
  )) {
    const plotIndex = unused.shift() ?? 0
    const plot = plots[plotIndex] ?? REST_POINT
    assigned.set(gardenPlotKey(resident), {
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

function unfinishedQuietStationForPlot(plot: {
  readonly x: number
  readonly y: number
}): Exclude<GardenPlaceStation, 'delivery' | 'waiting' | 'archive'> {
  const restDistance =
    (plot.x - REST_POINT.x) ** 2 + (plot.y - REST_POINT.y) ** 2
  const workbenchDistance =
    (plot.x - WORKBENCH_POINT.x) ** 2 + (plot.y - WORKBENCH_POINT.y) ** 2
  return restDistance <= workbenchDistance ? 'rest' : 'workbench'
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
    return '動いている。確認待ち'
  }
  if (resident.waiting) {
    return '確認待ち'
  }
  if (resident.working) {
    return '動いている'
  }
  return '静か'
}

export function describeVisibleFacts(resident: PlaceResident): string {
  const spoken = spokenWorkTitle(resident)
  const area = primaryArea(resident)
  if (resident.working && spoken && spoken.length <= BUBBLE_GOAL_MAX) {
    return spoken
  }
  if (resident.working && resident.workStory) {
    return resident.workStory
  }
  if (resident.working && area) {
    return `${area}まわりを直している`
  }
  if (resident.changedFileCount > 0) {
    return resident.workStory ?? leftoverWorkSummary(resident)
  }
  if (resident.waiting) {
    return '確認待ち'
  }
  if (resident.working) {
    return '動いている'
  }
  if ((resident.outgoingCount ?? 0) > 0) {
    return '送っていない'
  }
  if ((resident.incomingCount ?? 0) > 0) {
    return '取り込み待ち'
  }
  return spoken ?? ''
}

export function describePlaceInspect(
  resident: PlaceResident,
): PlaceInspectCopy {
  return {
    nowText: joinFactLines(inspectLastStateLines(resident)),
    implementationLook: null,
    nextStep: describeNextStep(resident),
    driverNote: resident.driverNote,
    goal: resident.working ? resident.goal : null,
    articleTitles: resident.articleTitles,
    workTitles: isBlogKitResident(resident) ? [] : resident.workTitles,
  }
}

function isBlogKitResident(
  resident: Pick<PlaceResident, 'articleTitles' | 'workStory'>,
): boolean {
  return resident.articleTitles.length > 0 || Boolean(resident.workStory)
}

function describePlaceWork(
  sessions: readonly OverviewSession[],
  repository: OverviewRepository,
  nowMs: number,
): string {
  const current = sessions.filter((session) =>
    shouldShowGardenDog(session, nowMs),
  )
  const ranked = [...current].sort(compareObservedAt)
  for (const session of ranked) {
    const title = spokenRecordTitle(session.title)
    if (title) {
      return title
    }
    const named = spokenRecordTitle(session.displayName)
    const sourceLabel = knownSourceLabel(session.source)
    if (
      named &&
      named !== sourceLabel &&
      named.toLowerCase() !== sourceKey(session.source)
    ) {
      return named
    }
  }
  const latest = ranked[0]
  if (latest) {
    const described = spokenRecordTitle(describeGardenWork(latest, repository))
    if (described && !described.endsWith('が対象です')) {
      return described
    }
  }
  return spokenRecordTitle(repository.latestRecordTitle) ?? ''
}

function inspectLastStateLines(resident: PlaceResident): string[] {
  const lines: string[] = []
  const spoken = spokenWorkTitle(resident)
  const spokenIsOnlyRecord =
    Boolean(spoken) &&
    !resident.working &&
    !resident.waiting &&
    spoken === softenRecordTitle(resident.latestRecordTitle)
  const leftover = resident.changedFileCount > 0
  const leftoverKinds = leftover ? leftoverKindsSentence(resident) : null
  const areaWork = resident.working ? describeAreaWork(resident) : null

  if (resident.waiting && !resident.working) {
    lines.push('確認待ち')
  }

  if (resident.workStory) {
    lines.push(resident.workStory)
  } else if (spoken && spoken !== '確認待ち' && !spokenIsOnlyRecord) {
    lines.push(spoken)
  } else if (resident.working && !resident.goal && areaWork) {
    lines.push(areaWork)
  } else if (resident.working && !resident.goal) {
    lines.push('動いている')
  }

  const record = describeLatestRecord(
    resident,
    resident.workStory ?? (spokenIsOnlyRecord ? null : spoken),
  )
  if (record && !resident.workStory) {
    lines.push(record)
  }

  if (
    leftover &&
    leftoverKinds &&
    !storyImpliesLeftover(resident.workStory) &&
    !lines.includes(leftoverKinds)
  ) {
    lines.push(leftoverKinds)
  } else if (
    leftover &&
    !leftoverKinds &&
    !storyImpliesLeftover(resident.workStory) &&
    !lines.some((line) => line.includes('途中の仕事'))
  ) {
    lines.push(LEFTOVER_WORK_REMAINING)
  }

  const seen = lastSeenLabel(resident)
  if (seen) {
    lines.push(`最後に見えたのは${seen}`)
  }

  if ((resident.outgoingCount ?? 0) > 0) {
    lines.push('送っていない')
  }
  if ((resident.incomingCount ?? 0) > 0) {
    lines.push('取り込み待ち')
  }

  return lines
}

function describeAreaWork(
  resident: Pick<PlaceResident, 'areas'>,
): string | null {
  const named = everydayInspectAreas(resident.areas)
  const shown = named.slice(0, 2)
  if (shown.length === 2) {
    return `${shown[0]}や${shown[1]}まわりを直している`
  }
  if (shown.length === 1) {
    return `${shown[0]}まわりを直している`
  }
  return null
}

function lastSeenLabel(resident: PlaceResident): string | null {
  const label = resident.lastObservedWorkLabel
  if (!label || !/(前|たった今)$/.test(label)) {
    return null
  }
  return label
}

function storyImpliesLeftover(story: string | null): boolean {
  return Boolean(
    story && (story.includes('続き') || story.includes('書いています')),
  )
}

function describeLatestRecord(
  resident: PlaceResident,
  spoken: string | null,
): string | null {
  const title = softenRecordTitle(resident.latestRecordTitle)
  if (!title || !isSpokenJapaneseTitle(title)) {
    return null
  }
  if (spoken && (title === spoken || softenRecordTitle(spoken) === title)) {
    return null
  }
  return `いちばん新しい記録：${title}`
}

function spokenWorkTitle(
  resident: Pick<PlaceResident, 'lastObservedWork'>,
): string | null {
  const softened = softenRecordTitle(resident.lastObservedWork)
  if (
    !softened ||
    softened === UNKNOWN_PLACE_WORK ||
    !isSpokenJapaneseTitle(softened)
  ) {
    return null
  }
  return softened
}

function leftoverKindsSentence(
  resident: Pick<PlaceResident, 'areas' | 'workStory'>,
): string | null {
  const named = leftoverKindAreas(resident)
  const shown = named.slice(0, 2)
  if (shown.length === 2) {
    return `${shown[0]}と${shown[1]}の途中が残っています。`
  }
  if (shown.length === 1) {
    return `${shown[0]}の途中が残っています。`
  }
  return null
}

function leftoverKindAreas(
  resident: Pick<PlaceResident, 'areas' | 'workStory'>,
): string[] {
  const labels = mapEverydayAreas(resident.areas, LEFTOVER_KIND_AREAS)
  if (resident.workStory && !labels.includes('記事')) {
    return ['記事', ...labels].slice(0, 2)
  }
  return labels
}

function leftoverWorkSummary(resident: Pick<PlaceResident, 'areas'>): string {
  const named = namedAreas(resident.areas).map(shortAreaForBubble)
  const shown = named.slice(0, 2)
  if (shown.length === 2) {
    return `${shown[0]}や${shown[1]}まわりに、途中の仕事がある`
  }
  if (shown.length === 1) {
    return `${shown[0]}まわりに、途中の仕事がある`
  }
  return '途中の仕事がある'
}

function primaryArea(resident: Pick<PlaceResident, 'areas'>): string | null {
  return namedAreas(resident.areas)[0] ?? null
}

function namedAreas(areas: readonly string[]): string[] {
  return uniqueLabels(areas).filter((item) => !isGenericArea(item))
}

function everydayInspectAreas(areas: readonly string[]): string[] {
  return mapEverydayAreas(areas, EVERYDAY_INSPECT_AREAS)
}

function mapEverydayAreas(
  areas: readonly string[],
  dictionary: Readonly<Record<string, string>>,
): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const area of uniqueLabels(areas)) {
    const everyday = dictionary[area]
    if (!everyday || seen.has(everyday)) {
      continue
    }
    seen.add(everyday)
    labels.push(everyday)
  }
  return labels
}

function shortAreaForBubble(area: string): string {
  return BUBBLE_AREA_SHORT[area] ?? area
}

function isGenericArea(area: string): boolean {
  return area === GENERIC_AREA_LABEL
}

function joinFactLines(lines: readonly string[]): string | null {
  const seen = new Set<string>()
  const facts: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    facts.push(trimmed)
  }
  return facts.length > 0 ? facts.join('\n') : null
}

function describeNextStep(
  resident: Pick<PlaceResident, 'waiting' | 'conflictCount'>,
): string | null {
  if (resident.waiting || resident.conflictCount > 0) {
    return '確認が必要'
  }
  return null
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
    if (!shouldShowGardenDog(session, nowMs)) {
      continue
    }
    if (!isConfirmedTool(session)) {
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

export function isConfirmedTool(session: OverviewSession): boolean {
  if (
    sourceKey(session.source) === 'git' ||
    session.attributionConfidence === 'inferred'
  ) {
    return false
  }
  if (!knownSourceLabel(session.source)) {
    return false
  }
  const surface = session.surface?.trim() ?? ''
  if (CONFIRMED_TOOL_SURFACES.has(surface)) {
    return true
  }
  const title = session.title?.trim() ?? ''
  return (
    session.attributionConfidence === 'verified' &&
    Boolean(title) &&
    !isGenericWorkTitle(title) &&
    title !== UNKNOWN_PLACE_WORK
  )
}

function everydayRecordTitle(value: string | null | undefined): string | null {
  const softened = softenRecordTitle(value)
  if (!softened || !isEverydayRecordTitle(softened)) {
    return null
  }
  return softened
}

function collectSpokenWorkTitles(repository: OverviewRepository): string[] {
  if (
    everydayArticleTitles(repository.articleTitles).length > 0 ||
    Boolean(everydayWorkStory(repository.workStory))
  ) {
    return []
  }
  const fromField = everydayWorkTitles(repository.workTitles)
  if (fromField.length > 0) {
    return fromField
  }
  const latest = spokenRecordTitle(repository.latestRecordTitle)
  return latest ? [latest] : []
}

function everydayWorkTitles(values: readonly string[] | undefined): string[] {
  const titles: string[] = []
  const seen = new Set<string>()
  for (const item of values ?? []) {
    const title = spokenRecordTitle(item)
    if (!title || seen.has(title)) {
      continue
    }
    seen.add(title)
    titles.push(title)
    if (titles.length >= MAX_VISIBLE_WORK_TITLES) {
      break
    }
  }
  return titles
}

function everydayArticleTitles(
  values:
    | readonly {
        readonly title: string
        readonly date?: string | null | undefined
      }[]
    | undefined,
): { readonly title: string; readonly date: string | null }[] {
  const titles: { readonly title: string; readonly date: string | null }[] = []
  const seen = new Set<string>()
  for (const item of values ?? []) {
    const title = item.title.trim()
    if (
      !title ||
      seen.has(title) ||
      title.includes('まだ分かっていません') ||
      title.includes('変更元不明') ||
      /\b(SHA|commit|HEAD|origin)\b/i.test(title) ||
      /\.(ts|tsx|css|json|md)$/i.test(title)
    ) {
      continue
    }
    seen.add(title)
    titles.push({
      title,
      date: item.date?.trim() || null,
    })
  }
  return titles
}

function pickResidentGoal(
  sessions: readonly OverviewSession[],
  nowMs: number,
): string | null {
  const ranked = [...sessions]
    .filter((session) => shouldShowGardenDog(session, nowMs))
    .sort(compareObservedAt)
  for (const session of ranked) {
    const goal = sessionGoal(session)
    if (goal) {
      return goal
    }
  }
  return null
}

function sessionGoal(session: OverviewSession): string | null {
  const fromField = acceptInspectGoal(session.goal)
  if (fromField) {
    return fromField
  }
  return acceptInspectGoal(session.title)
}

function acceptInspectGoal(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || isHookLeftoverTitle(trimmed) || isGenericWorkTitle(trimmed)) {
    return null
  }
  if (
    trimmed.includes('まだ分かっていません') ||
    trimmed.includes('変更元不明') ||
    trimmed === '動いている' ||
    trimmed === '作業中' ||
    /^[0-9a-f]{7,40}$/i.test(trimmed) ||
    /\b(SHA|commit|HEAD|origin)\b/i.test(trimmed)
  ) {
    return null
  }
  if (trimmed.length > 80) {
    return spokenRecordTitle(trimmed.slice(0, 80)) ?? null
  }
  return spokenRecordTitle(trimmed) ?? everydayWorkStory(trimmed)
}

function everydayWorkStory(value: string | null | undefined): string | null {
  const story = value?.trim() ?? ''
  if (!story) {
    return null
  }
  if (
    story.includes('まだ分かっていません') ||
    story.includes('変更元不明') ||
    /\b(SHA|commit|HEAD|origin)\b/i.test(story)
  ) {
    return null
  }
  return story
}

function spokenRecordTitle(value: string | null | undefined): string | null {
  const everyday = everydayRecordTitle(value)
  if (
    !everyday ||
    !isSpokenJapaneseTitle(everyday) ||
    everyday === UNKNOWN_PLACE_WORK ||
    everyday === UNKNOWN_GARDEN_WORK ||
    everyday.includes('まだ分かっていません')
  ) {
    return null
  }
  return everyday
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
