import { persistedEventSchema } from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { JobManager } from '../jobs/job-manager.js'
import {
  eventsAfter,
  readSseCursor,
  startSseStream,
  wantsEventStream,
} from '../jobs/sse.js'
import {
  assertSseAllowed,
  type SecurityConfig,
} from '../security/http-guard.js'

export function registerEventRoutes(
  app: FastifyInstance,
  jobs: JobManager,
  security: SecurityConfig,
): void {
  app.get('/api/events', async (request, reply) => {
    const existing = eventsAfter(
      jobs.listAllEvents().map((event) => persistedEventSchema.parse(event)),
      readSseCursor(request.headers['last-event-id'], request.query),
    )

    if (wantsEventStream(request.headers.accept)) {
      assertSseAllowed(request, security)
      reply.hijack()
      startSseStream({
        raw: reply.raw,
        replay: existing,
        subscribe: (listener) => jobs.subscribeAll(listener),
      })
      return
    }

    return { events: existing }
  })
}
