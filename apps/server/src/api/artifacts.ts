import {
  AppError,
  artifactContentSchema,
  confirmWriteRequestSchema,
} from '@sikumi-local/core'
import type { Artifact, ArtifactType } from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { JobManager } from '../jobs/job-manager.js'

export type PublicArtifact = {
  readonly id: string
  readonly jobId: string
  readonly type: ArtifactType
  readonly title: string
  readonly createdAt: string
}

export function toPublicArtifact(artifact: Artifact): PublicArtifact {
  return {
    id: artifact.id,
    jobId: artifact.jobId,
    type: artifact.type,
    title: artifact.title,
    createdAt: artifact.createdAt,
  }
}

export function registerArtifactRoutes(
  app: FastifyInstance,
  jobs: JobManager,
): void {
  app.get('/api/artifacts', async (request) => {
    const jobId =
      typeof request.query === 'object' &&
      request.query !== null &&
      'jobId' in request.query &&
      typeof request.query.jobId === 'string'
        ? request.query.jobId
        : undefined
    return {
      artifacts: jobs.listArtifacts(jobId).map(toPublicArtifact),
    }
  })

  app.get<{ Params: { id: string } }>('/api/artifacts/:id', async (request) => {
    return {
      artifact: toPublicArtifact(jobs.getArtifact(request.params.id)),
    }
  })

  app.get<{ Params: { id: string } }>(
    '/api/artifacts/:id/content',
    async (request) => {
      return artifactContentSchema.parse(
        jobs.getArtifactContent(request.params.id),
      )
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/artifacts/:id/apply',
    async (request) => {
      const parsed = confirmWriteRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Apply requires an explicit confirm',
          400,
        )
      }
      return {
        artifact: toPublicArtifact(
          jobs.applyArtifact(request.params.id, parsed.data.confirm),
        ),
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/artifacts/:id/export',
    async (request) => {
      const parsed = confirmWriteRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Export requires an explicit confirm',
          400,
        )
      }
      return jobs.exportArtifact(request.params.id, parsed.data.confirm)
    },
  )
}
