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
