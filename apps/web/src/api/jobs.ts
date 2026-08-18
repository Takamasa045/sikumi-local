import {
  artifactSchema,
  jobSchema,
  persistedEventSchema,
  type Artifact,
  type Job,
  type PersistedEvent,
} from '@sikumi-local/core'
import { z } from 'zod'
import { authorizedHeaders, toApiError, writeWithCsrfRetry } from './session.js'

const jobResponseSchema = z.object({ job: jobSchema })
const jobListSchema = z.object({ jobs: z.array(jobSchema) })
const eventListSchema = z.object({ events: z.array(persistedEventSchema) })
const artifactListSchema = z.object({ artifacts: z.array(artifactSchema) })
const artifactResponseSchema = z.object({ artifact: artifactSchema })

export async function createJob(input: {
  workspaceId: string
  request: string
}): Promise<Job> {
  const response = await writeWithCsrfRetry((token) =>
    fetch('/api/jobs', {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify(input),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return jobResponseSchema.parse(body).job
}

export async function getJob(id: string): Promise<Job> {
  const response = await fetch(`/api/jobs/${id}`, { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return jobResponseSchema.parse(body).job
}

export async function listJobs(workspaceId?: string): Promise<Job[]> {
  const suffix = workspaceId
    ? `?workspaceId=${encodeURIComponent(workspaceId)}`
    : ''
  const response = await fetch(`/api/jobs${suffix}`, { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return jobListSchema.parse(body).jobs
}

export async function listJobEvents(jobId: string): Promise<PersistedEvent[]> {
  const response = await fetch(`/api/jobs/${jobId}/events`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return eventListSchema.parse(body).events
}

export async function cancelJob(id: string): Promise<Job> {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/jobs/${id}/cancel`, {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({}),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return jobResponseSchema.parse(body).job
}

export async function listArtifacts(jobId?: string): Promise<Artifact[]> {
  const suffix = jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''
  const response = await fetch(`/api/artifacts${suffix}`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return artifactListSchema.parse(body).artifacts
}

export async function getArtifact(id: string): Promise<Artifact> {
  const response = await fetch(`/api/artifacts/${id}`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return artifactResponseSchema.parse(body).artifact
}
