import { persistedEventSchema, type PersistedEvent } from '@sikumi-local/core'

export function openEventStream(
  url: string,
  onEvent: (event: PersistedEvent) => void,
  onError: () => void,
): () => void {
  const Constructor =
    typeof EventSource === 'function' ? EventSource : undefined
  if (!Constructor) {
    return () => {}
  }

  let source: EventSource
  try {
    source = new Constructor(url, { withCredentials: true })
  } catch {
    return () => {}
  }

  source.onmessage = (message) => {
    try {
      onEvent(persistedEventSchema.parse(JSON.parse(message.data)))
    } catch {
      // Ignore malformed or non-canonical frames.
    }
  }
  source.onerror = () => {
    onError()
  }
  return () => {
    source.close()
  }
}
