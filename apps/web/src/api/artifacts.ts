import { artifactContentSchema, type ArtifactContent } from '@sikumi-local/core'
import { toApiError } from './session.js'

export async function getArtifactContent(id: string): Promise<ArtifactContent> {
  const response = await fetch(`/api/artifacts/${id}/content`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return artifactContentSchema.parse(body)
}
