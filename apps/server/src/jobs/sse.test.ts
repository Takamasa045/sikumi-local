import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import {
  activeSseConnectionCount,
  bindSseCleanup,
  eventsAfter,
  formatSseEvent,
  formatSseHeartbeat,
  readSseCursor,
  SSE_CONNECTED_COMMENT,
  SSE_MAX_BUFFERED_EVENTS,
  SSE_REPLAY_LIMIT,
  startSseStream,
  wantsEventStream,
} from './sse.js'

describe('sse helpers', () => {
  it('replays only events after the cursor and bounds the snapshot', () => {
    const events = [sample('a'), sample('b'), sample('c')]
    expect(eventsAfter(events, 'a').map((event) => event.id)).toEqual([
      'b',
      'c',
    ])
    expect(() => eventsAfter(events, 'missing')).toThrow(AppError)
    expect(() => eventsAfter(events, 'other-job')).toThrow(AppError)
    expect(eventsAfter(events, undefined)).toHaveLength(3)
    expect(eventsAfter(events, 'b').map((event) => event.id)).toEqual(['c'])
    const many = Array.from({ length: SSE_REPLAY_LIMIT + 5 }, (_, index) =>
      sample(`evt_${index}`),
    )
    const replayed = eventsAfter(many, 'evt_0')
    expect(replayed).toHaveLength(SSE_REPLAY_LIMIT)
    expect(replayed[0]?.id).not.toBe('evt_0')
    expect(replayed.at(-1)?.id).toBe(`evt_${SSE_REPLAY_LIMIT + 4}`)
  })

  it('formats events, heartbeats, and reads Last-Event-ID or cursor', () => {
    const encoded = formatSseEvent(sample('evt_1'))
    expect(encoded).toContain('id: evt_1')
    expect(encoded).toContain('data: {')
    expect(encoded).not.toContain('reasoning')
    expect(formatSseHeartbeat(1)).toBe(': keepalive 1\n\n')
    expect(readSseCursor('from-header', { cursor: 'from-query' })).toBe(
      'from-header',
    )
    expect(readSseCursor(undefined, { after: 'from-after' })).toBe('from-after')
    expect(wantsEventStream('text/event-stream')).toBe(true)
    expect(wantsEventStream('application/json')).toBe(false)
  })

  it('cleans up once on the streaming response close, not a second time', () => {
    const response = new EventEmitter()
    let cleaned = 0
    bindSseCleanup(response, () => {
      cleaned += 1
    })
    response.emit('close')
    response.emit('close')
    response.emit('error')
    expect(cleaned).toBe(1)
  })

  it('cleans up when the response socket closes', () => {
    const socket = new EventEmitter()
    const response = Object.assign(new EventEmitter(), { socket })
    let cleaned = 0
    bindSseCleanup(response, () => {
      cleaned += 1
    })
    socket.emit('close')
    expect(cleaned).toBe(1)
  })

  it('does not treat inbound request close or socket end as disconnect', () => {
    const request = new EventEmitter()
    const socket = new EventEmitter()
    const response = Object.assign(new EventEmitter(), { socket })
    let cleaned = 0
    bindSseCleanup(response, () => {
      cleaned += 1
    })
    request.emit('close')
    request.emit('end')
    socket.emit('end')
    expect(cleaned).toBe(0)
    response.emit('close')
    expect(cleaned).toBe(1)
  })

  it('tracks live connections and unsubscribes when the response closes', () => {
    const written: string[] = []
    const response = Object.assign(new EventEmitter(), {
      writeHead: () => undefined,
      write: (chunk: string) => {
        written.push(chunk)
      },
    })
    let unsubscribed = false
    const before = activeSseConnectionCount()
    startSseStream({
      raw: response,
      replay: [sample('replay')],
      subscribe: (listener) => {
        listener(sample('live'))
        return () => {
          unsubscribed = true
        }
      },
    })
    expect(activeSseConnectionCount()).toBe(before + 1)
    expect(written.join('')).toContain('id: replay')
    expect(written.join('')).toContain('id: live')
    expect(written.join('')).toContain(SSE_CONNECTED_COMMENT)
    expect(written.join('')).not.toContain('reasoning')
    response.emit('close')
    expect(unsubscribed).toBe(true)
    expect(activeSseConnectionCount()).toBe(before)
  })

  it('subscribes before replay so the boundary event is neither duplicated nor missed', () => {
    const written: string[] = []
    const response = Object.assign(new EventEmitter(), {
      writeHead: () => undefined,
      write: (chunk: string) => {
        written.push(chunk)
        return true
      },
    })
    let publish: ((event: ReturnType<typeof sample>) => void) | undefined
    startSseStream({
      raw: response,
      replay: () => {
        publish?.(sample('boundary-live'))
        return [sample('cursor'), sample('after-cursor')]
      },
      subscribe: (listener) => {
        publish = listener
        listener(sample('cursor'))
        return () => undefined
      },
    })
    const ids = written
      .join('')
      .match(/^id: (.+)$/gm)
      ?.map((line) => line.slice(4))
    expect(ids).toEqual(['cursor', 'after-cursor', 'boundary-live'])
  })

  it('bounds backpressure and cleans the listener when the response closes', () => {
    const response = Object.assign(new EventEmitter(), {
      writeHead: () => undefined,
      write: () => false,
    })
    let publish: ((event: ReturnType<typeof sample>) => void) | undefined
    let unsubscribed = false
    const before = activeSseConnectionCount()
    startSseStream({
      raw: response,
      replay: [],
      subscribe: (listener) => {
        publish = listener
        return () => {
          unsubscribed = true
        }
      },
    })
    for (let index = 0; index < 20; index += 1) {
      publish?.(sample(`live_${index}`))
    }
    expect(activeSseConnectionCount()).toBe(before + 1)
    response.emit('close')
    expect(unsubscribed).toBe(true)
    expect(activeSseConnectionCount()).toBe(before)
    publish?.(sample('after-close'))
  })

  it('does not write while blocked and flushes pending in order on drain', () => {
    const written: string[] = []
    const response = Object.assign(new EventEmitter(), {
      writeHead: () => undefined,
      write: (chunk: string) => {
        written.push(chunk)
        return false
      },
    })
    let publish: ((event: ReturnType<typeof sample>) => void) | undefined
    startSseStream({
      raw: response,
      replay: [sample('r1'), sample('r2')],
      subscribe: (listener) => {
        publish = listener
        return () => undefined
      },
    })
    expect(eventIds(written)).toEqual(['r1'])
    const writesWhileBlocked = written.length
    publish?.(sample('live1'))
    publish?.(sample('live2'))
    expect(written).toHaveLength(writesWhileBlocked)
    Object.assign(response, {
      write: (chunk: string) => {
        written.push(chunk)
        return true
      },
    })
    response.emit('drain')
    expect(eventIds(written)).toEqual(['r1', 'r2', 'live1', 'live2'])
  })

  it('fail-closes once on the 65th pending event and stays safe if close fires again', () => {
    let destroyed = 0
    let unsubscribed = 0
    const response = Object.assign(new EventEmitter(), {
      writeHead: () => undefined,
      write: () => false,
      destroy: () => {
        destroyed += 1
      },
    })
    let publish: ((event: ReturnType<typeof sample>) => void) | undefined
    const before = activeSseConnectionCount()
    startSseStream({
      raw: response,
      replay: [],
      subscribe: (listener) => {
        publish = listener
        return () => {
          unsubscribed += 1
        }
      },
    })
    for (let index = 0; index < SSE_MAX_BUFFERED_EVENTS; index += 1) {
      publish?.(sample(`live_${index}`))
    }
    expect(destroyed).toBe(0)
    expect(unsubscribed).toBe(0)
    expect(activeSseConnectionCount()).toBe(before + 1)
    publish?.(sample('live_overflow'))
    expect(destroyed).toBe(1)
    expect(unsubscribed).toBe(1)
    expect(activeSseConnectionCount()).toBe(before)
    publish?.(sample('after-overflow'))
    response.emit('close')
    response.emit('close')
    expect(destroyed).toBe(1)
    expect(unsubscribed).toBe(1)
    expect(activeSseConnectionCount()).toBe(before)
    expect(activeSseConnectionCount()).toBeGreaterThanOrEqual(0)
  })

  it('unsubscribes a sync 65-event burst without writeHead or a leaked listener', () => {
    let destroyed = 0
    let unsubscribed = 0
    let writeHeads = 0
    const response = Object.assign(new EventEmitter(), {
      writeHead: () => {
        writeHeads += 1
      },
      write: () => false,
      destroy: () => {
        destroyed += 1
      },
    })
    const before = activeSseConnectionCount()
    startSseStream({
      raw: response,
      replay: [],
      subscribe: (listener) => {
        for (let index = 0; index < SSE_MAX_BUFFERED_EVENTS + 1; index += 1) {
          listener(sample(`burst_${index}`))
        }
        return () => {
          unsubscribed += 1
        }
      },
    })
    expect(destroyed).toBe(1)
    expect(unsubscribed).toBe(1)
    expect(writeHeads).toBe(0)
    expect(activeSseConnectionCount()).toBe(before)
  })

  it('fail-closes on write exception without marking the event sent', () => {
    const written: string[] = []
    let destroyed = 0
    let unsubscribed = 0
    const response = Object.assign(new EventEmitter(), {
      writeHead: () => undefined,
      write: (chunk: string) => {
        if (chunk.includes('id: boom')) {
          throw new Error('write failed')
        }
        written.push(chunk)
        return true
      },
      destroy: () => {
        destroyed += 1
      },
    })
    let publish: ((event: ReturnType<typeof sample>) => void) | undefined
    startSseStream({
      raw: response,
      replay: [sample('ok')],
      subscribe: (listener) => {
        publish = listener
        return () => {
          unsubscribed += 1
        }
      },
    })
    publish?.(sample('boom'))
    expect(eventIds(written)).toEqual(['ok'])
    expect(destroyed).toBe(1)
    expect(unsubscribed).toBe(1)
    publish?.(sample('after-error'))
    expect(destroyed).toBe(1)
    expect(unsubscribed).toBe(1)
    expect(eventIds(written)).toEqual(['ok'])
  })
})

function sample(id: string) {
  return {
    id,
    jobId: 'job_1',
    runId: 'run_1',
    type: 'run.started' as const,
    payload: { summary: '仕事を始めます' },
    occurredAt: 't',
  }
}

function eventIds(written: readonly string[]): string[] {
  return (
    written
      .join('')
      .match(/^id: (.+)$/gm)
      ?.map((line) => line.slice(4)) ?? []
  )
}
