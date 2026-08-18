import { healthResponseSchema } from '@sikumi-local/core'
import { toApiError } from './session.js'

export async function getHealth() {
  const response = await fetch('/api/health', { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return healthResponseSchema.parse(body)
}
