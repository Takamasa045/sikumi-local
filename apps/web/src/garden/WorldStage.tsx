import { useCallback, useId, useState, type CSSProperties } from 'react'
import type { GardenStationId } from '@sikumi-local/core'
import { GardenEmployee } from './GardenEmployee'
import { GardenInspect, type GardenInspectSubject } from './GardenInspect'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { gardenStationLabels, type WorldPack } from './worlds'

interface WorldStageProps {
  readonly world: WorldPack
  readonly employeeName: string
  readonly employeeRole: string
  readonly employeeId?: string
  readonly station: GardenStationId
  readonly pose: string
  readonly activitySummary?: string
  readonly level?: number
  readonly unlocks?: readonly string[]
}

type StageStyle = CSSProperties & {
  '--world-background': string
}

type StationStyle = CSSProperties & {
  '--station-x': string
  '--station-y': string
}

const VISIBLE_STATIONS: GardenStationId[] = [
  'archive',
  'observatory',
  'workbench',
  'delivery',
  'waiting',
]

export function WorldStage({
  world,
  employeeName,
  employeeRole,
  employeeId,
  station,
  pose,
  activitySummary = 'まだ仕事は始まっていません',
  level = 1,
  unlocks = [],
}: WorldStageProps) {
  const inspectId = useId()
  const reducedMotion = usePrefersReducedMotion()
  const [inspect, setInspect] = useState<GardenInspectSubject | null>(null)
  const [traveling, setTraveling] = useState(false)
  const style: StageStyle = {
    '--world-background': `url(${world.backgroundUrl})`,
  }

  const closeInspect = useCallback(() => {
    setInspect(null)
  }, [])

  return (
    <section
      className="world-stage"
      data-testid="world-stage"
      data-world-pack={world.id}
      data-station={station}
      data-employee-id={employeeId ?? ''}
      data-pose={pose}
      data-level={String(level)}
      data-unlocks={unlocks.join(',')}
      data-traveling={traveling ? 'true' : 'false'}
      aria-labelledby="garden-heading"
      style={style}
    >
      <div className="world-stage__shade" />
      <header className="world-stage__heading">
        <p>WORLD PACK · {world.shortName}</p>
        <h1 id="garden-heading">{world.name}</h1>
        <span>{world.description}</span>
        <p className="world-stage__where" data-testid="garden-where">
          いま {gardenStationLabels[station]}
        </p>
      </header>

      <div className="world-stage__stations">
        {VISIBLE_STATIONS.map((id) => {
          const stationStyle: StationStyle = {
            '--station-x': `${world.stations[id].x}%`,
            '--station-y': `${world.stations[id].y}%`,
          }
          const related = station === id
          return (
            <button
              key={id}
              type="button"
              className={
                related ? 'garden-station is-active' : 'garden-station'
              }
              style={stationStyle}
              data-station={id}
              aria-expanded={
                inspect?.kind === 'station' && inspect.station === id
              }
              aria-controls={inspect ? inspectId : undefined}
              onClick={() => {
                setInspect({
                  kind: 'station',
                  station: id,
                  occupants: related
                    ? [
                        {
                          name: employeeName,
                          traveling,
                          summary: activitySummary,
                        },
                      ]
                    : [],
                })
              }}
            >
              <span className="garden-station__label">
                {gardenStationLabels[id]}
              </span>
            </button>
          )
        })}
      </div>

      <GardenEmployee
        world={world}
        name={employeeName}
        role={employeeRole}
        employeeId={employeeId ?? ''}
        station={station}
        pose={pose}
        summary={activitySummary}
        reducedMotion={reducedMotion}
        selected={inspect?.kind === 'character'}
        level={level}
        onTravelingChange={setTraveling}
        onSelect={() => {
          setInspect({
            kind: 'character',
            name: employeeName,
            role: employeeRole,
            station,
            traveling,
            summary: activitySummary,
          })
        }}
      />

      {inspect ? (
        <div id={inspectId}>
          <GardenInspect subject={inspect} onClose={closeInspect} />
        </div>
      ) : null}

      {unlocks.length > 0 ? (
        <ul className="world-stage__unlocks" data-testid="world-unlocks">
          {unlocks.map((unlock) => (
            <li key={unlock}>{unlock}</li>
          ))}
        </ul>
      ) : null}

      <div className="world-stage__local-mark" aria-label="ローカル専用">
        <span aria-hidden="true" />
        LOCAL ONLY
      </div>
    </section>
  )
}
