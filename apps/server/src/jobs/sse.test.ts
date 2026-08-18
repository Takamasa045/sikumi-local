import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  activeSseConnectionCount,
  bindSseCleanup,
  eventsAfter,
  formatSseEvent,
  formatSseHeartbeat,
  readSseCursor,
  SSE_CONNECTED_COMMENT,
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
    expect(eventsAfter(events, 'missing').map((event) => event.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(eventsAfter(events, undefined)).toHaveLength(3)
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
