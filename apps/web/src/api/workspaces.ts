import { workspaceSchema, type Workspace } from '@sikumi-local/core'
import { z } from 'zod'
import { authorizedHeaders, toApiError, writeWithCsrfRetry } from './session.js'

const workspaceListSchema = z.object({
  workspaces: z.array(workspaceSchema),
})

const workspaceResponseSchema = z.object({
  workspace: workspaceSchema,
})

export async function listWorkspaces(): Promise<Workspace[]> {
  const response = await fetch('/api/workspaces', { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return workspaceListSchema.parse(body).workspaces
}

export async function registerWorkspace(path: string): Promise<Workspace> {
  const response = await writeWithCsrfRetry((token) =>
    fetch('/api/workspaces', {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({ path }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return workspaceResponseSchema.parse(body).workspace
}
