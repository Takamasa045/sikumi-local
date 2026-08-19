import {
  OBSERVER_HUB_RECENT_LIMIT,
  type NormalizedObserverEvent,
} from '@sikumi-local/observer-core'

export type ObserverLiveEvent =
  | {
      readonly id: string
      readonly type: 'observer.event'
      readonly payload: NormalizedObserverEvent
      readonly occurredAt: string
    }
  | {
      readonly id: string
      readonly type: 'observer.rescan'
      readonly payload: { readonly repositoryId: string }
      readonly occurredAt: string
    }

type Listener = (event: ObserverLiveEvent) => void

export interface ObserverHub {
  publish(event: ObserverLiveEvent): void
  subscribe(listener: Listener): () => void
  listRecent(): ObserverLiveEvent[]
}

export function createObserverHub(): ObserverHub {
  const listeners = new Set<Listener>()
  const recent: ObserverLiveEvent[] = []

  return {
    publish(event) {
      recent.push(event)
      if (recent.length > OBSERVER_HUB_RECENT_LIMIT) {
        recent.shift()
      }
      for (const listener of listeners) {
        listener(event)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    listRecent() {
      return [...recent]
    },
  }
}
