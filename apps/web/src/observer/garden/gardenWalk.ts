import type { GardenPlaceActor } from '../places/placeResidents'

export const WORKING_WALK_PACE_STOPS = ['pace-a', 'pace-b'] as const
export const WORKING_WALK_LOOP_STOPS = [
  'loop-0',
  'loop-1',
  'loop-2',
  'loop-3',
] as const

export const WORKING_WALK_STOPS = [
  ...WORKING_WALK_PACE_STOPS,
  ...WORKING_WALK_LOOP_STOPS,
] as const satisfies readonly string[]

export type WorkingWalkStop = (typeof WORKING_WALK_STOPS)[number]
export type WorkingWalkKind = 'pace' | 'loop'
export type WorkingWalkFacing = 'left' | 'right'

const WORKING_WALK_CYCLE: readonly WorkingWalkStop[] = [
  'pace-a',
  'pace-b',
  'pace-a',
  'pace-b',
  'pace-a',
  'pace-b',
  'loop-0',
  'loop-1',
  'loop-2',
  'loop-3',
]

export const WORKING_WALK_FIRST_STEP_MS = 280
export const WORKING_WALK_DWELL_MS = 860
export const WORKING_WALK_LANE_X = 12
export const WORKING_WALK_LANE_Y = 4
export const WORKING_WALK_PACE_X = 4.4
export const WORKING_WALK_LOOP_RX = 3.2

const WALK_GROUND = {
  minX: 28,
  maxX: 72,
  minY: 54,
  maxY: 66,
} as const

const WALK_HOME = { x: 48, y: 60 } as const

type WalkActor = Pick<GardenPlaceActor, 'jitterX' | 'jitterY'> &
  Partial<
    Pick<
      GardenPlaceActor,
      'slot' | 'streamIndex' | 'groundX' | 'groundY' | 'key'
    >
  >

export function walkLaneOffset(
  actor: Partial<Pick<GardenPlaceActor, 'slot' | 'streamIndex'>>,
): { readonly x: number; readonly y: number } {
  const order = actor.slot ?? 0
  if (order <= 0) {
    return { x: 0, y: 0 }
  }
  const sign = order % 2 === 1 ? 1 : -1
  const rank = Math.ceil(order / 2)
  const tilt = ((actor.streamIndex ?? 0) + order) % 2 === 0 ? 1 : -1
  return {
    x: sign * rank * WORKING_WALK_LANE_X,
    y: tilt * WORKING_WALK_LANE_Y,
  }
}

export function walkStopKind(stop: WorkingWalkStop): WorkingWalkKind {
  return stop.startsWith('loop') ? 'loop' : 'pace'
}

export function isWorkingWalkStop(
  stop: string | null | undefined,
): stop is WorkingWalkStop {
  return (
    stop != null && (WORKING_WALK_STOPS as readonly string[]).includes(stop)
  )
}

export function initialWalkIndex(key: string): number {
  return walkKeyHash(key) % WORKING_WALK_CYCLE.length
}

export function nextWalkIndex(index: number): number {
  return (index + 1) % WORKING_WALK_CYCLE.length
}

export function walkStopAt(
  index: number,
  actor: Partial<Pick<GardenPlaceActor, 'slot' | 'streamIndex'>> = {},
): WorkingWalkStop {
  const stop = WORKING_WALK_CYCLE.at(index) ?? 'pace-a'
  if (walkStopKind(stop) !== 'loop' || walkSpin(actor) === 1) {
    return stop
  }
  const loopIndex = Number(stop.slice(5))
  return WORKING_WALK_LOOP_STOPS.at((4 - loopIndex) % 4) ?? 'loop-0'
}

export function walkOrigin(actor: WalkActor): {
  readonly x: number
  readonly y: number
} {
  const lane = walkLaneOffset(actor)
  return clampWalkPoint({
    x: (actor.groundX ?? WALK_HOME.x) + lane.x + actor.jitterX,
    y: (actor.groundY ?? WALK_HOME.y) + lane.y + actor.jitterY,
  })
}

export function workingWalkPoint(
  stop: WorkingWalkStop,
  actor: WalkActor,
): { readonly x: number; readonly y: number } {
  const origin = walkOrigin(actor)
  const local = walkLocalOffset(stop, actor)
  return clampWalkPoint({
    x: origin.x + local.x,
    y: origin.y + local.y,
  })
}

export function walkFacing(
  destination: { readonly x: number; readonly y: number },
  actor: WalkActor,
): WorkingWalkFacing {
  const origin = walkOrigin(actor)
  if (destination.x < origin.x - 0.15) {
    return 'left'
  }
  if (destination.x > origin.x + 0.15) {
    return 'right'
  }
  return destination.y >= origin.y ? 'right' : 'left'
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

function walkLocalOffset(
  stop: WorkingWalkStop,
  actor: WalkActor,
): { readonly x: number; readonly y: number } {
  const tilt = walkTilt(actor)
  if (stop === 'pace-a') {
    return { x: -WORKING_WALK_PACE_X, y: -tilt }
  }
  if (stop === 'pace-b') {
    return { x: WORKING_WALK_PACE_X, y: tilt }
  }
  const loopIndex = Number(stop.slice(5))
  const angle = (loopIndex * Math.PI) / 2
  return {
    x: Math.cos(angle) * WORKING_WALK_LOOP_RX,
    y: Math.sin(angle) * walkLoopRy(actor),
  }
}

function walkSpin(
  actor: Partial<Pick<GardenPlaceActor, 'slot' | 'streamIndex'>>,
): 1 | -1 {
  return ((actor.slot ?? 0) + (actor.streamIndex ?? 0)) % 2 === 0 ? 1 : -1
}

function walkTilt(actor: WalkActor): number {
  const slot = actor.slot ?? 0
  const stream = actor.streamIndex ?? 0
  const sign = (slot + stream) % 2 === 0 ? 1 : -1
  return sign * (1.1 + Math.abs(actor.jitterY) * 2 + (slot % 3) * 0.25)
}

function walkLoopRy(actor: WalkActor): number {
  const slot = actor.slot ?? 0
  const stream = actor.streamIndex ?? 0
  return 1.8 + (slot % 3) * 0.35 + (stream % 2) * 0.25 + Math.abs(actor.jitterY)
}

function clampWalkPoint(point: { readonly x: number; readonly y: number }): {
  readonly x: number
  readonly y: number
} {
  return {
    x: clamp(point.x, WALK_GROUND.minX, WALK_GROUND.maxX),
    y: clamp(point.y, WALK_GROUND.minY, WALK_GROUND.maxY),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function walkKeyHash(key: string): number {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
