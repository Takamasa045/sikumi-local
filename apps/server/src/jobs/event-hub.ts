import type { PersistedEvent } from '@sikumi-local/core'

type Listener = (event: PersistedEvent) => void

export interface EventHub {
  publish(jobId: string, event: PersistedEvent): void
  subscribe(jobId: string, listener: Listener): () => void
  subscribeAll(listener: Listener): () => void
  jobSubscriberCount(jobId: string): number
  globalSubscriberCount(): number
}

export function createEventHub(): EventHub {
  const listeners = new Map<string, Set<Listener>>()
  const globalListeners = new Set<Listener>()

  return {
    publish(jobId, event) {
      for (const listener of listeners.get(jobId) ?? []) {
        listener(event)
      }
      for (const listener of globalListeners) {
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
    subscribeAll(listener) {
      globalListeners.add(listener)
      return () => {
        globalListeners.delete(listener)
      }
    },
    jobSubscriberCount(jobId) {
      return listeners.get(jobId)?.size ?? 0
    },
    globalSubscriberCount() {
      return globalListeners.size
    },
  }
}
