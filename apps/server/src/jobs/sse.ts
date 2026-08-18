import {
  AppError,
  persistedEventSchema,
  type PersistedEvent,
} from '@sikumi-local/core'

export const SSE_HEARTBEAT_MS = 15_000
export const SSE_REPLAY_LIMIT = 200
export const SSE_MAX_BUFFERED_EVENTS = 64
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
  destroy?(): unknown
  end?(): unknown
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
  readonly replay: readonly PersistedEvent[] | (() => readonly PersistedEvent[])
  readonly subscribe: (listener: (event: PersistedEvent) => void) => () => void
}): void {
  const sent = new Set<string>()
  const pending: PersistedEvent[] = []
  let live = false
  let blocked = false
  let closed = false

  const cleanup = (): void => {
    closed = true
    if (counted) {
      activeSseConnections = Math.max(0, activeSseConnections - 1)
      counted = false
    }
    if (heartbeat !== undefined) {
      clearInterval(heartbeat)
      heartbeat = undefined
    }
    pending.length = 0
    input.raw.off?.('drain', onDrain)
    unsubscribe()
    unsubscribe = () => {}
  }

  const failClose = (): void => {
    if (closed) {
      return
    }
    cleanup()
    if (typeof input.raw.destroy === 'function') {
      input.raw.destroy()
    } else {
      input.raw.end?.()
    }
  }

  const writeChunk = (chunk: string): boolean => {
    try {
      if (input.raw.write(chunk) === false) {
        blocked = true
        return false
      }
      return true
    } catch {
      failClose()
      return false
    }
  }

  const emit = (event: PersistedEvent): void => {
    if (closed || sent.has(event.id)) {
      return
    }
    const chunk = formatSseEvent(persistedEventSchema.parse(event))
    try {
      const accepted = input.raw.write(chunk)
      // write() returning false still accepted the chunk.
      sent.add(event.id)
      if (accepted === false) {
        blocked = true
      }
    } catch {
      failClose()
    }
  }

  const enqueue = (event: PersistedEvent): void => {
    if (
      closed ||
      sent.has(event.id) ||
      pending.some((item) => item.id === event.id)
    ) {
      return
    }
    if (pending.length >= SSE_MAX_BUFFERED_EVENTS) {
      failClose()
      return
    }
    pending.push(event)
  }

  const flushPending = (): void => {
    if (blocked || closed) {
      return
    }
    while (pending.length > 0 && !blocked && !closed) {
      const next = pending.shift()
      if (next) {
        emit(next)
      }
    }
  }

  let unsubscribe = () => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let counted = false
  const onDrain = () => {
    if (closed) {
      return
    }
    blocked = false
    flushPending()
  }

  try {
    unsubscribe = input.subscribe((event) => {
      if (closed || sent.has(event.id)) {
        return
      }
      if (!live || blocked) {
        enqueue(event)
        return
      }
      emit(event)
    })
    if (closed) {
      unsubscribe()
      unsubscribe = () => {}
      return
    }
    input.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    })
    const replay =
      typeof input.replay === 'function' ? input.replay() : input.replay
    for (const event of replay) {
      if (closed) {
        break
      }
      if (blocked) {
        enqueue(event)
      } else {
        emit(event)
      }
    }
    flushPending()
    if (closed) {
      return
    }
    live = true
    if (!blocked) {
      writeChunk(SSE_CONNECTED_COMMENT)
    }
    if (closed) {
      return
    }
    heartbeat = setInterval(() => {
      if (blocked || closed) {
        return
      }
      writeChunk(formatSseHeartbeat())
    }, SSE_HEARTBEAT_MS)
    input.raw.on('drain', onDrain)
    activeSseConnections += 1
    counted = true
  } catch (error) {
    cleanup()
    throw error
  }
  bindSseCleanup(input.raw, cleanup)
}

export function formatSseEvent(event: PersistedEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`
}

export function formatSseHeartbeat(at = Date.now()): string {
  return `: keepalive ${at}\n\n`
}

export function assertSseCursorOwnedByJob(
  cursor: string,
  jobId: string,
  lookup: (id: string) => { readonly jobId: string | null } | undefined,
): void {
  const found = lookup(cursor)
  if (!found || found.jobId !== jobId) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Cursor does not belong to this job',
      400,
    )
  }
}

export function eventsAfter(
  events: readonly PersistedEvent[],
  afterId: string | undefined,
): PersistedEvent[] {
  if (!afterId) {
    return boundReplay(events)
  }
  const index = events.findIndex((event) => event.id === afterId)
  if (index < 0) {
    throw new AppError('VALIDATION_FAILED', 'Unknown SSE cursor', 400)
  }
  return boundReplay(events.slice(index + 1))
}

function boundReplay(events: readonly PersistedEvent[]): PersistedEvent[] {
  if (events.length <= SSE_REPLAY_LIMIT) {
    return [...events]
  }
  return events.slice(events.length - SSE_REPLAY_LIMIT)
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
