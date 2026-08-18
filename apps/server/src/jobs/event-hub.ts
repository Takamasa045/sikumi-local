import type { PersistedEvent } from '@sikumi-local/core'

type Listener = (event: PersistedEvent) => void

export interface EventHub {
  publish(jobId: string, event: PersistedEvent): void
  subscribe(jobId: string, listener: Listener): () => void
}

export function createEventHub(): EventHub {
  const listeners = new Map<string, Set<Listener>>()

  return {
    publish(jobId, event) {
      for (const listener of listeners.get(jobId) ?? []) {
        listener(event)
      }
    },
    subscribe(jobId, listener) {
      const set = listeners.get(jobId) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(jobId, set)
      return () => {
        set.delete(listener)
        if (set.size === 0) {
          listeners.delete(jobId)
        }
      }
    },
  }
}
