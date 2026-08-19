import { unrefTimer } from './repository-watcher.js'

export interface ScanScheduler {
  runIfDue(repositoryId: string): boolean
  schedule(repositoryId: string): void
  force(repositoryId: string): void
  flush(): void
  clear(): void
  pendingCount(): number
  lastScanAt(repositoryId: string): number | undefined
}

export function createScanScheduler(input: {
  readonly scan: (repositoryId: string) => void
  readonly throttleMs?: number
  readonly debounceMs?: number
  readonly now?: () => number
  readonly setTimeoutFn?: typeof setTimeout
  readonly clearTimeoutFn?: typeof clearTimeout
}): ScanScheduler {
  const throttleMs = input.throttleMs ?? 2_000
  const debounceMs = input.debounceMs ?? 500
  const now = input.now ?? Date.now
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout
  const lastScan = new Map<string, number>()
  const inFlight = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function run(repositoryId: string): boolean {
    if (inFlight.has(repositoryId)) {
      return false
    }
    inFlight.add(repositoryId)
    try {
      input.scan(repositoryId)
      lastScan.set(repositoryId, now())
      return true
    } finally {
      inFlight.delete(repositoryId)
    }
  }

  return {
    runIfDue(repositoryId) {
      const last = lastScan.get(repositoryId)
      if (last !== undefined && now() - last < throttleMs) {
        return false
      }
      return run(repositoryId)
    },
    schedule(repositoryId) {
      const existing = timers.get(repositoryId)
      if (existing) {
        clearTimeoutFn(existing)
      }
      const timer = setTimeoutFn(() => {
        timers.delete(repositoryId)
        const last = lastScan.get(repositoryId)
        if (last !== undefined && now() - last < throttleMs) {
          return
        }
        run(repositoryId)
      }, debounceMs)
      unrefTimer(timer)
      timers.set(repositoryId, timer)
    },
    force(repositoryId) {
      const existing = timers.get(repositoryId)
      if (existing) {
        clearTimeoutFn(existing)
        timers.delete(repositoryId)
      }
      run(repositoryId)
    },
    flush() {
      for (const [repositoryId, timer] of timers) {
        clearTimeoutFn(timer)
        timers.delete(repositoryId)
        const last = lastScan.get(repositoryId)
        if (last !== undefined && now() - last < throttleMs) {
          continue
        }
        run(repositoryId)
      }
    },
    clear() {
      for (const timer of timers.values()) {
        clearTimeoutFn(timer)
      }
      timers.clear()
    },
    pendingCount() {
      return timers.size + inFlight.size
    },
    lastScanAt(repositoryId) {
      return lastScan.get(repositoryId)
    },
  }
}
