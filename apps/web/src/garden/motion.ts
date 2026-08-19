export interface GardenPoint {
  readonly x: number
  readonly y: number
}

export type GardenGesture = 'idle' | 'working' | 'waiting' | 'walking'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function readPrefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  )
}

export function reducedMotionQuery(): string {
  return REDUCED_MOTION_QUERY
}

export function travelDurationMs(from: GardenPoint, to: GardenPoint): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  if (distance < 0.5) {
    return 0
  }
  return Math.round(Math.min(1400, Math.max(480, distance * 16)))
}

export function poseGesture(pose: string, traveling: boolean): GardenGesture {
  if (traveling) {
    return 'walking'
  }
  if (pose === 'waiting') {
    return 'waiting'
  }
  if (
    pose === 'working' ||
    pose === 'reading' ||
    pose === 'searching' ||
    pose === 'delivering'
  ) {
    return 'working'
  }
  return 'idle'
}
