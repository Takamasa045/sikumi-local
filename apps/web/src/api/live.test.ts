import { describe, expect, it, vi } from 'vitest'
import { openEventStream } from './live'

describe('openEventStream', () => {
  it('parses canonical events and closes the source', () => {
    const listeners: Record<string, ((event: MessageEvent) => void) | null> = {}
    const close = vi.fn()
    class FakeEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        listeners.open = null
      }
      close() {
        close()
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const received: string[] = []
    const stop = openEventStream(
      '/api/events',
      (event) => {
        received.push(event.id)
      },
      vi.fn(),
    )
    const source = (
      FakeEventSource as unknown as { prototype: FakeEventSource }
    ).prototype
    void source
    stop()
    expect(close).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('returns a noop when EventSource is missing', () => {
    vi.stubGlobal('EventSource', undefined)
    const stop = openEventStream('/api/events', vi.fn(), vi.fn())
    expect(() => {
      stop()
    }).not.toThrow()
    vi.unstubAllGlobals()
  })

  it('ignores a constructor failure and malformed frames', () => {
    class Boom {
      constructor() {
        throw new Error('no sse')
      }
    }
    vi.stubGlobal('EventSource', Boom)
    const stop = openEventStream('/api/events', vi.fn(), vi.fn())
    expect(() => {
      stop()
    }).not.toThrow()
    vi.unstubAllGlobals()

    const instances: Array<{
      onmessage: ((event: MessageEvent) => void) | null
      onerror: (() => void) | null
    }> = []
    class Capture {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        instances.push(this)
      }
      close() {}
    }
    vi.stubGlobal('EventSource', Capture)
    const onEvent = vi.fn()
    const onError = vi.fn()
    const close = openEventStream('/api/events', onEvent, onError)
    instances[0]!.onmessage?.({ data: 'not-json' } as MessageEvent)
    instances[0]!.onerror?.()
    expect(onEvent).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalled()
    close()
    vi.unstubAllGlobals()
  })
})
