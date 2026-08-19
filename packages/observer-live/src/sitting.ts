import type { LiveProcessRow } from './types.js'

/** A process this old, sleeping, with no children and ~0% CPU is sitting, not working. */
export const LIVE_SITTING_MIN_AGE_MS = 12 * 60 * 60 * 1000

const SLEEPING_STATES = new Set(['S', 'I', 'T'])

export function isSleepingProcessState(
  state: string | null | undefined,
): boolean {
  const letter = (state ?? '').trim().charAt(0).toUpperCase()
  return SLEEPING_STATES.has(letter)
}

export function isSittingLiveProcess(
  process: Pick<
    LiveProcessRow,
    'state' | 'cpuPercent' | 'startedAtMs' | 'childCount' | 'childCwds'
  >,
  now = Date.now(),
): boolean {
  if (!isSleepingProcessState(process.state)) {
    return false
  }
  if (process.cpuPercent != null && process.cpuPercent > 0.5) {
    return false
  }
  const children = process.childCount ?? process.childCwds?.length ?? 0
  if (children > 0) {
    return false
  }
  if (process.startedAtMs == null) {
    return false
  }
  return now - process.startedAtMs >= LIVE_SITTING_MIN_AGE_MS
}

export function parseElapsedToMs(
  value: string | null | undefined,
): number | null {
  const raw = (value ?? '').trim()
  if (!raw) {
    return null
  }
  const match = raw.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!match) {
    return null
  }
  const days = Number(match[1] ?? 0)
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3] ?? 0)
  const seconds = Number(match[4] ?? 0)
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000
}
