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
import { useStationTravel } from '../../garden/useStationTravel'
import { gardenStationLabels, getWorldPack } from '../../garden/worlds'
import {
  collectGardenActors,
  type GardenPlaceActor,
} from '../places/placeResidents'

const WORLD_ID = 'dog-office' as const
const ATLAS_COLUMNS = 3
const ATLAS_ROWS = 4
const ATLAS_X_PERCENTS = ['0%', '50%', '100%'] as const
const ATLAS_Y_PERCENTS = ['0%', '33.333%', '66.667%', '100%'] as const

const STATION_IDS = [
  'archive',
  'observatory',
  'workbench',
  'delivery',
  'waiting',
  'rest',
] as const

const STATION_SLOT_OFFSETS = [
  [-12, 0],
  [12, 0],
  [-7, 11],
  [7, 11],
  [0, -10],
] as const

type StationId = (typeof STATION_IDS)[number]

type ObserverGardenProps = {
  overview: TodayOverview | null
  workspaces?: readonly Workspace[]
  onOpenWorkshop: () => void
  onOpenSettings: () => void
}

function atlasPosition(column: number, row: number): { x: string; y: string } {
  const x = ATLAS_X_PERCENTS[column] ?? ATLAS_X_PERCENTS[0]
  const y = ATLAS_Y_PERCENTS[row] ?? ATLAS_Y_PERCENTS[0]
  return { x, y }
}

function stationPoint(
  stations: ReturnType<typeof getWorldPack>['stations'],
  id: StationId,
): { x: number; y: number } {
  const point = stations[id]
  return {
    x: point?.x ?? 50,
    y: point?.y ?? 50,
  }
}

function actorAriaLabel(actor: GardenPlaceActor): string {
  return [actor.placeName, actor.workSummary].join('、')
}

function actorOffset(actor: GardenPlaceActor): { x: number; y: number } {
  const slot =
    STATION_SLOT_OFFSETS[actor.slot % STATION_SLOT_OFFSETS.length] ??
    STATION_SLOT_OFFSETS[0]!
  const lap = Math.floor(actor.slot / STATION_SLOT_OFFSETS.length)
  return {
    x: slot[0] + actor.jitterX + lap * 3,
    y: slot[1] + actor.jitterY + lap * 2,
  }
}

export function ObserverGarden({
  overview,
  workspaces = [],
  onOpenWorkshop,
  onOpenSettings,
}: ObserverGardenProps) {
  const world = getWorldPack(WORLD_ID)
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

  return (
    <div className="observer-garden-page">
      <section
        className="observer-garden observer-garden--satoyama"
        role="region"
        aria-label="観測の庭"
        style={gardenStyle}
      >
        <div className="observer-garden-mist" aria-hidden="true" />

        <header className="observer-garden-nav">
          <div className="observer-garden-heading-group">
            <h2 className="observer-garden-heading">観測の庭</h2>
            <p className="observer-garden-sign">犬たちの里山アトリエ</p>
          </div>
          <div className="observer-garden-nav-actions">
            <button
              type="button"
              className="observer-garden-nav-button observer-garden-nav-workshop"
              onClick={onOpenWorkshop}
            >
              今日の作業場
            </button>
            <button
              type="button"
              className="observer-garden-nav-button observer-garden-nav-settings"
              onClick={onOpenSettings}
            >
              設定
            </button>
          </div>
        </header>

        <div className="observer-garden-ground">
          {STATION_IDS.map((id) => {
            const point = stationPoint(world.stations, id)
            const label = gardenStationLabels[id]
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
                  onSelect={() => {
                    setSelectedKey(actor.key)
                    setInspect({
                      kind: 'character',
                      name: actor.placeName,
                      station: actor.station,
                      traveling: actorTravel[actor.key] === true,
                      summary: actor.workSummary,
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

          {inspect ? (
            <GardenInspect subject={inspect} onClose={closeInspect} />
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
  readonly onSelect: () => void
  readonly onTravelingChange: (traveling: boolean) => void
}) {
  const point = stationPoint(world.stations, actor.station)
  const offset = actorOffset(actor)
  const destination = {
    x: point.x + offset.x,
    y: point.y + offset.y,
  }
  const {
    point: travelPoint,
    traveling,
    durationMs,
  } = useStationTravel(destination, reducedMotion)
  const pose =
    actor.tone === 'waiting'
      ? 'waiting'
      : actor.tone === 'working'
        ? 'working'
        : 'idle'
  const gesture = poseGesture(pose, traveling && !reducedMotion)
  const atlas = atlasPosition(actor.column, actor.row)
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
      aria-label={actorAriaLabel(actor)}
      data-testid={`garden-place-${actor.repositoryId}`}
      data-status={actor.tone}
      data-station={actor.station}
      data-gesture={gesture}
      data-traveling={traveling ? 'true' : 'false'}
      style={actorStyle}
    >
      <button
        type="button"
        className="observer-garden-actor-hit"
        aria-expanded={selected}
        onClick={onSelect}
      >
        <div className="observer-garden-actor-sprite" style={spriteStyle} />
      </button>
      <div className="observer-garden-bubble">
        <p className="observer-garden-bubble-source">{actor.placeName}</p>
        <p className="observer-garden-bubble-title">{actor.workSummary}</p>
      </div>
    </article>
  )
}

export default ObserverGarden
