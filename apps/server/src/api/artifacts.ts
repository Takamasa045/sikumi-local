import { artifactSchema } from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { JobManager } from '../jobs/job-manager.js'

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
      artifacts: jobs
        .listArtifacts(jobId)
        .map((artifact) => artifactSchema.parse(artifact)),
    }
  })

  app.get<{ Params: { id: string } }>('/api/artifacts/:id', async (request) => {
    return {
      artifact: artifactSchema.parse(jobs.getArtifact(request.params.id)),
    }
  })
}
