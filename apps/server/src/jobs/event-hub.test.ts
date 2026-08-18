import { describe, expect, it } from 'vitest'
import { createEventHub } from './event-hub.js'

describe('event hub', () => {
  it('publishes only to the subscribed job and can unsubscribe', () => {
    const hub = createEventHub()
    const received: string[] = []
    const unsubscribe = hub.subscribe('job_1', (event) => {
      received.push(event.id)
    })

    hub.publish('job_2', sampleEvent('other'))
    hub.publish('job_1', sampleEvent('keep'))
    unsubscribe()
    hub.publish('job_1', sampleEvent('after'))

    expect(received).toEqual(['keep'])
  })

  it('notifies global subscribers without mixing after unsubscribe', () => {
    const hub = createEventHub()
    const received: string[] = []
    const unsubscribe = hub.subscribeAll((event) => {
      received.push(event.id)
    })
    hub.publish('job_1', sampleEvent('one'))
    unsubscribe()
    hub.publish('job_1', sampleEvent('two'))
    expect(received).toEqual(['one'])
  })

  it('reports subscriber counts after subscribe and cleanup', () => {
    const hub = createEventHub()
    expect(hub.jobSubscriberCount('job_1')).toBe(0)
    expect(hub.globalSubscriberCount()).toBe(0)
    const stopJob = hub.subscribe('job_1', () => undefined)
    const stopAll = hub.subscribeAll(() => undefined)
    expect(hub.jobSubscriberCount('job_1')).toBe(1)
    expect(hub.globalSubscriberCount()).toBe(1)
    stopJob()
    stopAll()
    expect(hub.jobSubscriberCount('job_1')).toBe(0)
    expect(hub.globalSubscriberCount()).toBe(0)
  })
})

function sampleEvent(id: string) {
  return {
    id,
    jobId: 'job_1',
    runId: 'run_1',
    type: 'run.started' as const,
    payload: { summary: '仕事を始めます' },
    occurredAt: 't',
  }
}
