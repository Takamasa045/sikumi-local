import { persistedEventSchema, type PersistedEvent } from '@sikumi-local/core'

export const SSE_HEARTBEAT_MS = 15_000
export const SSE_REPLAY_LIMIT = 200
export const SSE_CONNECTED_COMMENT = ': connected\n\n'

let activeSseConnections = 0

export function activeSseConnectionCount(): number {
  return activeSseConnections
}

export interface SseCleanupTarget {
  on(event: string, listener: () => void): unknown
  off?(event: string, listener: () => void): unknown
  socket?: { on(event: string, listener: () => void): unknown } | null
}

export interface SseWritable extends SseCleanupTarget {
  writeHead(status: number, headers: Record<string, string>): unknown
  write(chunk: string): unknown
}

export function bindSseCleanup(
  response: SseCleanupTarget,
  cleanup: () => void,
): () => void {
  let cleaned = false
  const run = () => {
    if (cleaned) {
      return
    }
    cleaned = true
    cleanup()
  }
  // Do not bind request.raw or socket 'end': a GET request completes
  // immediately and would unsubscribe before live events arrive.
  response.on('close', run)
  response.on('error', run)
  response.on('finish', run)
  response.socket?.on('close', run)
  response.socket?.on('error', run)
  return run
}

export function startSseStream(input: {
  readonly raw: SseWritable
  readonly replay: readonly PersistedEvent[]
  readonly subscribe: (listener: (event: PersistedEvent) => void) => () => void
}): void {
  const sent = new Set(input.replay.map((event) => event.id))
  input.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  for (const event of input.replay) {
    writeSse(input.raw, formatSseEvent(event))
  }
  writeSse(input.raw, SSE_CONNECTED_COMMENT)
  const heartbeat = setInterval(() => {
    writeSse(input.raw, formatSseHeartbeat())
  }, SSE_HEARTBEAT_MS)
  const unsubscribe = input.subscribe((event) => {
    if (sent.has(event.id)) {
      return
    }
    sent.add(event.id)
    writeSse(input.raw, formatSseEvent(persistedEventSchema.parse(event)))
  })
  activeSseConnections += 1
  bindSseCleanup(input.raw, () => {
    activeSseConnections = Math.max(0, activeSseConnections - 1)
    clearInterval(heartbeat)
    unsubscribe()
  })
}

function writeSse(raw: SseWritable, chunk: string): void {
  try {
    raw.write(chunk)
  } catch {
    // The client already dropped the stream.
  }
}

export function formatSseEvent(event: PersistedEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`
}

export function formatSseHeartbeat(at = Date.now()): string {
  return `: keepalive ${at}\n\n`
}

export function eventsAfter(
  events: readonly PersistedEvent[],
  afterId: string | undefined,
): PersistedEvent[] {
  const bounded =
    events.length > SSE_REPLAY_LIMIT
      ? events.slice(events.length - SSE_REPLAY_LIMIT)
      : [...events]
  if (!afterId) {
    return bounded
  }
  const index = bounded.findIndex((event) => event.id === afterId)
  if (index < 0) {
    return bounded
  }
  return bounded.slice(index + 1)
}

export function readSseCursor(
  lastEventId: string | string[] | undefined,
  query: unknown,
): string | undefined {
  const header = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId
  if (header && header.trim().length > 0) {
    return header.trim()
  }
  if (
    typeof query === 'object' &&
    query !== null &&
    'cursor' in query &&
    typeof query.cursor === 'string' &&
    query.cursor.trim().length > 0
  ) {
    return query.cursor.trim()
  }
  if (
    typeof query === 'object' &&
    query !== null &&
    'after' in query &&
    typeof query.after === 'string' &&
    query.after.trim().length > 0
  ) {
    return query.after.trim()
  }
  return undefined
}

export function wantsEventStream(acceptHeader: string | undefined): boolean {
  return (acceptHeader ?? '').includes('text/event-stream')
}
