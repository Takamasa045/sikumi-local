import {
  AppError,
  confirmWriteRequestSchema,
  createJobRequestSchema,
  jobSchema,
  persistedEventSchema,
} from '@sikumi-local/core'
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

export function registerJobRoutes(
  app: FastifyInstance,
  jobs: JobManager,
  security: SecurityConfig,
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
        ...(parsed.data.employeeId
          ? { employeeId: parsed.data.employeeId }
          : {}),
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
        ...(parsed.data.dirtyWorktreePolicy
          ? { dirtyWorktreePolicy: parsed.data.dirtyWorktreePolicy }
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
    '/api/jobs/:id/worktree',
    async (request) => {
      return jobs.describeWorktree(request.params.id)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/jobs/:id/worktree/discard',
    async (request) => {
      const parsed = confirmWriteRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Discard requires an explicit confirm',
          400,
        )
      }
      return {
        job: jobSchema.parse(
          jobs.discardWorktree(request.params.id, parsed.data.confirm),
        ),
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/jobs/:id/worktree/keep',
    async (request) => {
      const parsed = confirmWriteRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Keep requires an explicit confirm',
          400,
        )
      }
      return {
        job: jobSchema.parse(
          jobs.keepWorktree(request.params.id, parsed.data.confirm),
        ),
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/jobs/:id/events',
    async (request, reply) => {
      if (wantsEventStream(request.headers.accept)) {
        assertSseAllowed(request, security)
        const existing = eventsAfter(
          jobs
            .listEvents(request.params.id)
            .map((event) => persistedEventSchema.parse(event)),
          readSseCursor(request.headers['last-event-id'], request.query),
        )
        reply.hijack()
        startSseStream({
          raw: reply.raw,
          replay: existing,
          subscribe: (listener) => jobs.subscribe(request.params.id, listener),
        })
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
