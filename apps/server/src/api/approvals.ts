import {
  AppError,
  approvalRequestSchema,
  resolveApprovalRequestSchema,
} from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { JobManager } from '../jobs/job-manager.js'

export function registerApprovalRoutes(
  app: FastifyInstance,
  jobs: JobManager,
): void {
  app.get('/api/approvals', async (request) => {
    const query =
      typeof request.query === 'object' && request.query !== null
        ? request.query
        : {}
    const jobId =
      'jobId' in query && typeof query.jobId === 'string'
        ? query.jobId
        : undefined
    const status =
      'status' in query &&
      (query.status === 'pending' ||
        query.status === 'approved' ||
        query.status === 'denied')
        ? query.status
        : undefined
    const filter: {
      jobId?: string
      status?: 'pending' | 'approved' | 'denied'
    } = {}
    if (jobId) {
      filter.jobId = jobId
    }
    if (status) {
      filter.status = status
    }
    return {
      approvals: jobs
        .listApprovals(filter)
        .map((approval) => approvalRequestSchema.parse(approval)),
    }
  })

  app.post<{ Params: { id: string } }>(
    '/api/approvals/:id/resolve',
    async (request) => {
      const parsed = resolveApprovalRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Approval decision is invalid',
          400,
        )
      }
      return {
        approval: approvalRequestSchema.parse(
          await jobs.resolveApproval(request.params.id, parsed.data.decision),
        ),
      }
    },
  )
}
