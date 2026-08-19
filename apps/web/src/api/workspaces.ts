import {
  chooseWorkspaceFolderResponseSchema,
  unregisterWorkspaceResponseSchema,
  workspaceSchema,
  type ProviderId,
  type Workspace,
} from '@sikumi-local/core'
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

export async function registerWorkspace(
  path: string,
  employeeName?: string,
): Promise<Workspace> {
  const response = await writeWithCsrfRetry((token) =>
    fetch('/api/workspaces', {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({ path, ...(employeeName ? { employeeName } : {}) }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return workspaceResponseSchema.parse(body).workspace
}

export async function updateWorkspace(
  id: string,
  defaultProviderId: ProviderId | null,
): Promise<Workspace> {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({ defaultProviderId }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return workspaceResponseSchema.parse(body).workspace
}

export async function chooseWorkspaceFolder(): Promise<string | null> {
  const response = await writeWithCsrfRetry((token) =>
    fetch('/api/workspaces/choose-folder', {
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
  const parsed = chooseWorkspaceFolderResponseSchema.parse(body)
  return parsed.cancelled ? null : parsed.path
}

export async function unregisterWorkspace(id: string): Promise<void> {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/workspaces/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({}),
    }),
  )
  if (response.status === 204) {
    return
  }
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  unregisterWorkspaceResponseSchema.parse(body)
}

export async function updateWorkspaceEmployeeName(
  id: string,
  employeeName: string,
): Promise<Workspace> {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({ employeeName }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return workspaceResponseSchema.parse(body).workspace
}
