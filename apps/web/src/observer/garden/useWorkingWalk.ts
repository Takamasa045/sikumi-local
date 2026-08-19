import { useEffect, useRef, useState } from 'react'
import { useStationTravel } from '../../garden/useStationTravel'
import type {
  GardenPlaceActor,
  GardenPlaceStation,
} from '../places/placeResidents'
import {
  WORKING_WALK_DWELL_MS,
  WORKING_WALK_FIRST_STEP_MS,
  initialWalkIndex,
  nextWalkIndex,
  walkFacing,
  walkStopAt,
  workingWalkPoint,
  type WorkingWalkFacing,
  type WorkingWalkStop,
} from './gardenWalk'

export function useWorkingWalk(
  actor: Pick<
    GardenPlaceActor,
    | 'key'
    | 'tone'
    | 'station'
    | 'jitterX'
    | 'jitterY'
    | 'slot'
    | 'streamIndex'
    | 'groundX'
    | 'groundY'
  >,
  home: { readonly x: number; readonly y: number },
  reducedMotion: boolean,
): {
  readonly point: { readonly x: number; readonly y: number }
  readonly traveling: boolean
  readonly durationMs: number
  readonly walkStation: GardenPlaceStation
  readonly walkStop: WorkingWalkStop | GardenPlaceStation
  readonly destination: { readonly x: number; readonly y: number }
  readonly facing: WorkingWalkFacing
} {
  const working = actor.tone === 'working' && !reducedMotion
  const [index, setIndex] = useState(() => initialWalkIndex(actor.key))
  const currentStop = walkStopAt(index, actor)
  const walkStation = actor.station
  const walkStop = working ? currentStop : actor.station
  const destination = working ? workingWalkPoint(currentStop, actor) : home
  const facing = working ? walkFacing(destination, actor) : 'right'
  const travel = useStationTravel(destination, reducedMotion)
  const firstStep = useRef(true)

  useEffect(() => {
    if (!working) {
      firstStep.current = true
      return
    }
    if (travel.traveling) {
      return
    }
    const wait = firstStep.current
      ? WORKING_WALK_FIRST_STEP_MS
      : WORKING_WALK_DWELL_MS
    firstStep.current = false
    const timer = window.setTimeout(() => {
      setIndex((current) => nextWalkIndex(current))
    }, wait)
    return () => {
      window.clearTimeout(timer)
    }
  }, [working, travel.traveling, index])

  return {
    point: travel.point,
    traveling: travel.traveling,
    durationMs: travel.durationMs,
    walkStation,
    walkStop,
    destination,
    facing,
  }
}
