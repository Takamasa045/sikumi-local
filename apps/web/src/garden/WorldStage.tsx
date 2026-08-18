import type { CSSProperties } from 'react'
import type { GardenStationId } from '@sikumi-local/core'
import { gardenStationLabels, type WorldPack } from './worlds'

interface WorldStageProps {
  readonly world: WorldPack
  readonly employeeName: string
  readonly employeeRole: string
  readonly employeeId?: string
  readonly station: GardenStationId
  readonly pose: string
  readonly activitySummary?: string
}

type StageStyle = CSSProperties & {
  '--world-background': string
  '--character-atlas': string
  '--atlas-columns': number
  '--atlas-rows': number
  '--atlas-x': string
  '--atlas-y': string
  '--character-x': string
  '--character-y': string
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
}: WorldStageProps) {
  const columnPosition =
    world.character.atlasColumns === 1
      ? 0
      : (world.character.atlasColumn / (world.character.atlasColumns - 1)) * 100
  const rowPosition =
    world.character.atlasRows === 1
      ? 0
      : (world.character.atlasRow / (world.character.atlasRows - 1)) * 100
  const position = world.stations[station] ?? world.character.position
  const style: StageStyle = {
    '--world-background': `url(${world.backgroundUrl})`,
    '--character-atlas': `url(${world.character.atlasUrl})`,
    '--atlas-columns': world.character.atlasColumns,
    '--atlas-rows': world.character.atlasRows,
    '--atlas-x': `${columnPosition}%`,
    '--atlas-y': `${rowPosition}%`,
    '--character-x': `${position.x}%`,
    '--character-y': `${position.y}%`,
  }

  return (
    <section
      className="world-stage"
      data-testid="world-stage"
      data-world-pack={world.id}
      data-station={station}
      data-employee-id={employeeId ?? ''}
      data-pose={pose}
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
          return (
            <div
              key={id}
              className={
                id === station ? 'garden-station is-active' : 'garden-station'
              }
              style={stationStyle}
              data-station={id}
            >
              <span className="garden-station__label">
                {gardenStationLabels[id]}
              </span>
            </div>
          )
        })}
      </div>

      <div
        className={station === 'rest' ? 'employee is-idle' : 'employee'}
        aria-label={`${employeeName}、${employeeRole}、${gardenStationLabels[station]}`}
      >
        <div className="employee__note" role="status">
          <strong>{employeeName}</strong>
          <span>{employeeRole}</span>
          <small>{activitySummary}</small>
        </div>
        <div className="employee__sprite" aria-hidden="true" />
        <div className="employee__shadow" aria-hidden="true" />
      </div>

      <div className="world-stage__local-mark" aria-label="ローカル専用">
        <span aria-hidden="true" />
        LOCAL ONLY
      </div>
    </section>
  )
}
