import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { GardenStationId } from '@sikumi-local/core'
import { poseGesture } from './motion'
import { useStationTravel } from './useStationTravel'
import { gardenStationLabels, type WorldPack } from './worlds'

interface GardenEmployeeProps {
  readonly world: WorldPack
  readonly name: string
  readonly role: string
  readonly station: GardenStationId
  readonly pose: string
  readonly summary: string
  readonly reducedMotion: boolean
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onTravelingChange?: (traveling: boolean) => void
  readonly level?: number
  readonly employeeId?: string | undefined
}

type EmployeeStyle = CSSProperties & {
  '--character-atlas': string
  '--atlas-columns': number
  '--atlas-rows': number
  '--atlas-x': string
  '--atlas-y': string
  '--garden-travel-ms': string
}

export function GardenEmployee({
  world,
  name,
  role,
  station,
  pose,
  summary,
  reducedMotion,
  selected,
  onSelect,
  onTravelingChange,
  level = 1,
  employeeId,
}: GardenEmployeeProps) {
  const [ready, setReady] = useState(false)
  const grownRow = Math.min(
    world.character.atlasRows - 1,
    world.character.atlasRow + Math.max(0, level - 1),
  )
  const columnPosition =
    world.character.atlasColumns === 1
      ? 0
      : (world.character.atlasColumn / (world.character.atlasColumns - 1)) * 100
  const rowPosition =
    world.character.atlasRows === 1
      ? 0
      : (grownRow / (world.character.atlasRows - 1)) * 100
  const destination = world.stations[station] ?? world.character.position
  const { point, traveling, durationMs } = useStationTravel(
    destination,
    reducedMotion,
  )
  const gesture = poseGesture(pose, traveling && !reducedMotion)
  const place = gardenStationLabels[station]
  const style: EmployeeStyle = {
    left: `${point.x}%`,
    top: `${point.y}%`,
    '--character-atlas': `url(${world.character.atlasUrl})`,
    '--atlas-columns': world.character.atlasColumns,
    '--atlas-rows': world.character.atlasRows,
    '--atlas-x': `${columnPosition}%`,
    '--atlas-y': `${rowPosition}%`,
    '--garden-travel-ms': `${durationMs || 720}ms`,
  }

  const onTravelingChangeRef = useRef(onTravelingChange)
  onTravelingChangeRef.current = onTravelingChange

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    onTravelingChangeRef.current?.(traveling)
  }, [traveling])

  const className = [
    'employee',
    ready && !reducedMotion ? 'is-ready' : '',
    traveling ? 'is-traveling' : '',
    gesture === 'idle' ? 'is-idle' : '',
    `is-${gesture}`,
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      style={style}
      data-testid="garden-employee"
      data-employee-id={employeeId ?? ''}
      data-station={station}
      data-pose={pose}
      data-gesture={gesture}
      data-traveling={traveling ? 'true' : 'false'}
      aria-expanded={selected}
      aria-label={`${name}、${role}、${traveling ? `${place}へ向かっています` : place}、${summary}`}
      onClick={onSelect}
    >
      <span className="employee__name">{name}</span>
      <div className="employee__sprite" aria-hidden="true" />
      <div className="employee__shadow" aria-hidden="true" />
    </button>
  )
}
