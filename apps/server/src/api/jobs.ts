import {
  AppError,
  createJobRequestSchema,
  jobSchema,
  persistedEventSchema,
} from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { JobManager } from '../jobs/job-manager.js'

export function registerJobRoutes(
  app: FastifyInstance,
  jobs: JobManager,
): void {
  app.get('/api/jobs', async (request) => {
    const workspaceId =
      typeof request.query === 'object' &&
      request.query !== null &&
      'workspaceId' in request.query &&
      typeof request.query.workspaceId === 'string'
        ? request.query.workspaceId
        : undefined
    return {
      jobs: jobs.listJobs(workspaceId).map((job) => jobSchema.parse(job)),
    }
  })

  app.post('/api/jobs', async (request, reply) => {
    const parsed = createJobRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Job request is invalid', 400)
    }
    const job = jobSchema.parse(
      await jobs.createJob({
        workspaceId: parsed.data.workspaceId,
        request: parsed.data.request,
        jobType: parsed.data.jobType,
        ...(parsed.data.selectedProvider
          ? { selectedProvider: parsed.data.selectedProvider }
          : {}),
        ...(parsed.data.confirmFallbackProvider
          ? { confirmFallbackProvider: parsed.data.confirmFallbackProvider }
          : {}),
        ...(parsed.data.permissionProfile
          ? { permissionProfile: parsed.data.permissionProfile }
          : {}),
        ...(parsed.data.selectedModel
          ? { selectedModel: parsed.data.selectedModel }
          : {}),
      }),
    )
    return reply.status(201).send({ job })
  })

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request) => {
    return { job: jobSchema.parse(jobs.getJob(request.params.id)) }
  })

  app.post<{ Params: { id: string } }>(
    '/api/jobs/:id/cancel',
    async (request) => {
      return { job: jobSchema.parse(await jobs.cancelJob(request.params.id)) }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/jobs/:id/events',
    async (request, reply) => {
      const accept = request.headers.accept ?? ''
      if (accept.includes('text/event-stream')) {
        const existing = jobs
          .listEvents(request.params.id)
          .map((event) => persistedEventSchema.parse(event))
        reply.hijack()
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        })
        for (const event of existing) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
        }
        const unsubscribe = jobs.subscribe(request.params.id, (event) => {
          reply.raw.write(
            `data: ${JSON.stringify(persistedEventSchema.parse(event))}\n\n`,
          )
        })
        request.raw.on('close', unsubscribe)
        return
      }

      return {
        events: jobs
          .listEvents(request.params.id)
          .map((event) => persistedEventSchema.parse(event)),
      }
    },
  )
}
