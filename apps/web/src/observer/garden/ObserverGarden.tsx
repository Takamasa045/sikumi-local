import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import {
  GardenInspect,
  type GardenInspectSubject,
} from '../../garden/GardenInspect'
import { poseGesture } from '../../garden/motion'
import { usePrefersReducedMotion } from '../../garden/usePrefersReducedMotion'
import { useGardenWorldPack } from '../../garden/useGardenWorldPack'
import { getWorldPack, worldPacks } from '../../garden/worlds'
import {
  collectGardenActors,
  GARDEN_PLACE_POINTS,
  type GardenPlaceActor,
} from '../places/placeResidents'
import { placeRepoLabel } from './gardenWalk'
import { useWorkingWalk } from './useWorkingWalk'

const ATLAS_COLUMNS = 3
const ATLAS_ROWS = 4
const ATLAS_X_PERCENTS = ['0%', '50%', '100%'] as const
const ATLAS_Y_PERCENTS = ['0%', '33.333%', '66.667%', '100%'] as const

const VISIBLE_GARDEN_PLACES = [
  'workbench',
  'delivery',
  'waiting',
  'rest',
] as const

type StationId = (typeof VISIBLE_GARDEN_PLACES)[number]

export const observerGardenPlaceLabels: Record<StationId, string> = {
  workbench: '仕事',
  delivery: '届ける',
  waiting: '確認待ち',
  rest: '合間',
}

export const observerGardenPlaceMeanings: Record<StationId, string> = {
  workbench: '動いている仕事がいる場所',
  delivery: '届いた仕事だけがいる場所',
  waiting: 'あなたの確認を待つ場所',
  rest: '仕事の合間にいる場所',
}

type ObserverGardenProps = {
  overview: TodayOverview | null
  workspaces?: readonly Workspace[]
  onOpenWorkshop: () => void
}

function atlasPosition(column: number, row: number): { x: string; y: string } {
  const x = ATLAS_X_PERCENTS[column] ?? ATLAS_X_PERCENTS[0]
  const y = ATLAS_Y_PERCENTS[row] ?? ATLAS_Y_PERCENTS[0]
  return { x, y }
}

function describeObserverPlaceOccupants(
  id: StationId,
  occupants: readonly {
    readonly name: string
    readonly traveling: boolean
  }[],
): string {
  const place = observerGardenPlaceLabels[id]
  if (occupants.length === 0) {
    return `${place}に、いまは誰もいません`
  }
  return occupants
    .map((occupant) =>
      occupant.traveling
        ? `${occupant.name}が${place}へ向かっています`
        : `${occupant.name}が${place}にいます`,
    )
    .join('。')
}

function actorAriaLabel(
  actor: GardenPlaceActor,
  repoLabel: string | null,
): string {
  return [actor.placeName, repoLabel, actor.workSummary]
    .filter((part): part is string => Boolean(part))
    .join('、')
}

function actorPoint(actor: GardenPlaceActor): { x: number; y: number } {
  return {
    x: actor.groundX + actor.jitterX,
    y: actor.groundY + actor.jitterY,
  }
}

export function ObserverGarden({
  overview,
  workspaces = [],
  onOpenWorkshop,
}: ObserverGardenProps) {
  const { world, setWorldPackId } = useGardenWorldPack()
  const actors = collectGardenActors(overview, workspaces)
  const reducedMotion = usePrefersReducedMotion()
  const [inspect, setInspect] = useState<GardenInspectSubject | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [actorTravel, setActorTravel] = useState<Record<string, boolean>>({})
  const closeInspect = useCallback(() => {
    setInspect(null)
    setSelectedKey(null)
  }, [])
  const handleActorTravel = useCallback((key: string, next: boolean) => {
    setActorTravel((current) =>
      current[key] === next ? current : { ...current, [key]: next },
    )
  }, [])

  const gardenStyle: CSSProperties = {
    backgroundImage: `url("${world.backgroundUrl}")`,
  }

  function stationOccupants(id: StationId) {
    const occupants: {
      name: string
      traveling: boolean
      summary?: string
    }[] = []
    for (const actor of actors) {
      if (actor.station !== id) {
        continue
      }
      occupants.push({
        name: actor.placeName,
        traveling: actorTravel[actor.key] === true,
        summary: actor.workSummary,
      })
    }
    return occupants
  }

  const inspectSubject = liveInspectSubject(
    inspect,
    actors,
    selectedKey,
    stationOccupants,
  )

  return (
    <div className="observer-garden-page">
      <section
        className="observer-garden observer-garden--satoyama"
        role="region"
        aria-label="観測の庭"
        data-world-pack={world.id}
        data-garden-floor="square"
        style={gardenStyle}
      >
        <div className="observer-garden-mist" aria-hidden="true" />

        <header className="observer-garden-nav">
          <div className="observer-garden-heading-group">
            <h2 className="observer-garden-heading">観測の庭</h2>
            <p className="observer-garden-sign">{world.name}</p>
            <div
              className="observer-garden-look"
              role="group"
              aria-label="庭の様子"
              data-testid="garden-look"
            >
              {worldPacks.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  className="observer-garden-nav-button observer-garden-look-button"
                  aria-pressed={world.id === pack.id}
                  onClick={() => {
                    setWorldPackId(pack.id)
                  }}
                >
                  {pack.lookName}
                </button>
              ))}
            </div>
          </div>
          <div className="observer-garden-nav-actions">
            <button
              type="button"
              className="observer-garden-nav-button observer-garden-nav-workshop"
              onClick={onOpenWorkshop}
            >
              今日の作業場
            </button>
          </div>
        </header>

        <div className="observer-garden-ground">
          {VISIBLE_GARDEN_PLACES.map((id) => {
            const point = GARDEN_PLACE_POINTS[id]
            const label = observerGardenPlaceLabels[id]
            const occupants = stationOccupants(id)
            return (
              <button
                key={id}
                type="button"
                className={`observer-garden-station observer-garden-station--${id}`}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                aria-expanded={
                  inspect?.kind === 'station' && inspect.station === id
                }
                onClick={() => {
                  setSelectedKey(null)
                  setInspect({
                    kind: 'station',
                    station: id,
                    occupants,
                    title: label,
                    meaning: observerGardenPlaceMeanings[id],
                    occupantsText: describeObserverPlaceOccupants(
                      id,
                      occupants,
                    ),
                  })
                }}
              >
                <span className="observer-garden-station-pill">{label}</span>
              </button>
            )
          })}

          {actors.length > 0 ? (
            <div
              className="observer-garden-actors"
              role="list"
              aria-label="庭の住人"
            >
              {actors.map((actor) => (
                <ObserverGardenActor
                  key={actor.key}
                  actor={actor}
                  world={world}
                  reducedMotion={reducedMotion}
                  selected={selectedKey === actor.key}
                  onTravelingChange={(next) => {
                    handleActorTravel(actor.key, next)
                  }}
                  onSelect={(presence) => {
                    setSelectedKey(actor.key)
                    setInspect({
                      kind: 'character',
                      name: actor.placeName,
                      station: presence.station,
                      traveling: presence.traveling,
                      summary: actor.workSummary,
                      nowText: actor.nowText,
                      implementationLook: actor.implementationLook,
                      nextStep: actor.nextStep,
                      driverNote: actor.driverNote,
                      live: actor.tone === 'working' || presence.traveling,
                      goal: actor.goal,
                      placeIntro: actor.placeIntro,
                      articleTitles: actor.articleTitles,
                      workTitles: actor.workTitles,
                    })
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="observer-garden-guide">
              登録した場所がまだありません。今日の作業場からフォルダを追加してください。
            </p>
          )}

          {inspectSubject ? (
            <GardenInspect subject={inspectSubject} onClose={closeInspect} />
          ) : null}
        </div>
      </section>
    </div>
  )
}

function ObserverGardenActor({
  actor,
  world,
  reducedMotion,
  selected,
  onSelect,
  onTravelingChange,
}: {
  readonly actor: GardenPlaceActor
  readonly world: ReturnType<typeof getWorldPack>
  readonly reducedMotion: boolean
  readonly selected: boolean
  readonly onSelect: (presence: {
    readonly traveling: boolean
    readonly station: GardenPlaceActor['station']
  }) => void
  readonly onTravelingChange: (traveling: boolean) => void
}) {
  const home = actorPoint(actor)
  const {
    point: travelPoint,
    traveling,
    durationMs,
    walkStation,
    walkStop,
    destination,
    facing,
  } = useWorkingWalk(actor, home, reducedMotion)
  const pose =
    actor.tone === 'waiting'
      ? 'waiting'
      : actor.tone === 'working'
        ? 'working'
        : 'idle'
  const gesture = poseGesture(pose, traveling && !reducedMotion)
  const atlas = atlasPosition(actor.column, actor.row)
  const repoLabel = placeRepoLabel(actor.placeName, actor.repositoryName)
  const spriteStyle = {
    '--observer-atlas-x': atlas.x,
    '--observer-atlas-y': atlas.y,
    '--observer-atlas-columns': String(ATLAS_COLUMNS),
    '--observer-atlas-rows': String(ATLAS_ROWS),
    backgroundImage: `url("${world.character.atlasUrl}")`,
  } as CSSProperties
  const actorStyle = {
    left: `${travelPoint.x}%`,
    top: `${travelPoint.y}%`,
    zIndex: Math.max(1, Math.round(travelPoint.y)),
    '--garden-travel-ms': `${durationMs || 720}ms`,
    '--garden-walk-face': facing === 'left' ? '-1' : '1',
  } as CSSProperties
  const [ready, setReady] = useState(false)
  const onTravelingChangeRef = useRef(onTravelingChange)
  onTravelingChangeRef.current = onTravelingChange

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    onTravelingChangeRef.current(traveling)
  }, [traveling])

  return (
    <article
      className={[
        'observer-garden-actor',
        `observer-garden-actor--${actor.station}`,
        ready && !reducedMotion ? 'is-ready' : '',
        traveling ? 'is-traveling' : '',
        selected ? 'is-selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="listitem"
      aria-label={actorAriaLabel(actor, repoLabel)}
      data-testid={
        actor.streamIndex > 0
          ? `garden-place-${actor.repositoryId}-${actor.streamIndex + 1}`
          : `garden-place-${actor.repositoryId}`
      }
      data-status={actor.tone}
      data-station={actor.station}
      data-walk-stop={walkStop}
      data-walk-facing={facing}
      data-ground-x={String(Math.round(actor.groundX))}
      data-ground-y={String(Math.round(actor.groundY))}
      data-walk-x={String(Math.round(destination.x))}
      data-walk-y={String(Math.round(destination.y))}
      data-gesture={gesture}
      data-traveling={traveling ? 'true' : 'false'}
      style={actorStyle}
    >
      <button
        type="button"
        className="observer-garden-actor-hit"
        aria-expanded={selected}
        onClick={() => {
          onSelect({ traveling, station: walkStation })
        }}
      >
        <div className="observer-garden-actor-sprite" style={spriteStyle} />
      </button>
      <div className="observer-garden-bubble">
        <p className="observer-garden-bubble-source">{actor.placeName}</p>
        {repoLabel ? (
          <p className="observer-garden-bubble-repo">{repoLabel}</p>
        ) : null}
        {actor.workSummary ? (
          <p className="observer-garden-bubble-title">{actor.workSummary}</p>
        ) : null}
      </div>
    </article>
  )
}

function liveInspectSubject(
  inspect: GardenInspectSubject | null,
  actors: readonly GardenPlaceActor[],
  selectedKey: string | null,
  stationOccupants: (id: StationId) => readonly {
    readonly name: string
    readonly traveling: boolean
    readonly summary?: string
  }[],
): GardenInspectSubject | null {
  if (!inspect) {
    return null
  }
  if (inspect.kind === 'station') {
    const occupants = stationOccupants(inspect.station)
    const place = inspect.station as StationId
    const label = observerGardenPlaceLabels[place]
    return {
      ...inspect,
      occupants,
      title: label ?? inspect.title,
      meaning: observerGardenPlaceMeanings[place] ?? inspect.meaning,
      occupantsText: label
        ? describeObserverPlaceOccupants(place, occupants)
        : inspect.occupantsText,
    }
  }
  const actor = actors.find((item) => item.key === selectedKey)
  if (!actor) {
    return inspect
  }
  return {
    ...inspect,
    name: actor.placeName,
    station: inspect.traveling ? inspect.station : actor.station,
    summary: actor.workSummary,
    nowText: actor.nowText,
    implementationLook: actor.implementationLook,
    nextStep: actor.nextStep,
    driverNote: actor.driverNote,
    live: actor.tone === 'working' || inspect.traveling,
    goal: actor.goal,
    placeIntro: actor.placeIntro,
    articleTitles: actor.articleTitles,
    workTitles: actor.workTitles,
  }
}

export default ObserverGarden
