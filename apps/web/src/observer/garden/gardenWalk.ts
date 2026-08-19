import type {
  GardenPlaceActor,
  GardenPlaceStation,
} from '../places/placeResidents'

export const WORKING_WALK_STOPS = [
  'archive',
  'workbench',
  'waiting',
] as const satisfies readonly GardenPlaceStation[]

export type WorkingWalkStop = (typeof WORKING_WALK_STOPS)[number]

export const WORKING_WALK_POINTS: Record<
  WorkingWalkStop,
  { readonly x: number; readonly y: number }
> = {
  archive: { x: 24, y: 36 },
  workbench: { x: 49, y: 38 },
  waiting: { x: 78, y: 44 },
}

export const WORKING_WALK_FIRST_STEP_MS = 280
export const WORKING_WALK_DWELL_MS = 2400
export const WORKING_WALK_LANE_X = 12
export const WORKING_WALK_LANE_Y = 4

export function walkLaneOffset(
  actor: Partial<Pick<GardenPlaceActor, 'slot' | 'streamIndex'>>,
): { readonly x: number; readonly y: number } {
  const order = actor.streamIndex ?? 0
  if (order <= 0) {
    return { x: 0, y: 0 }
  }
  const sign = order % 2 === 1 ? 1 : -1
  const rank = Math.ceil(order / 2)
  const slotTilt = (actor.slot ?? 0) % 2 === 0 ? 1 : -1
  return {
    x: sign * rank * WORKING_WALK_LANE_X,
    y: slotTilt * WORKING_WALK_LANE_Y,
  }
}

export function initialWalkIndex(key: string): number {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % WORKING_WALK_STOPS.length
}

export function nextWalkIndex(index: number): number {
  return (index + 1) % WORKING_WALK_STOPS.length
}

export function walkStopAt(index: number): WorkingWalkStop {
  return WORKING_WALK_STOPS.at(index) ?? 'workbench'
}

export function workingWalkPoint(
  stop: WorkingWalkStop,
  actor: Pick<GardenPlaceActor, 'jitterX' | 'jitterY'> &
    Partial<Pick<GardenPlaceActor, 'slot' | 'streamIndex'>>,
): { readonly x: number; readonly y: number } {
  const point = WORKING_WALK_POINTS[stop]
  const lane = walkLaneOffset(actor)
  return {
    x: point.x + lane.x + actor.jitterX,
    y: point.y + lane.y + actor.jitterY,
  }
}

export function placeRepoLabel(
  placeName: string,
  repositoryName: string,
): string | null {
  const repo = repositoryName.trim()
  if (!repo) {
    return null
  }
  const place = placeName.trim()
  if (!place) {
    return repo
  }
  if (place === repo || place === `${repo}番` || place.includes(repo)) {
    return null
  }
  return repo
}
