import {
  growthSnapshotSchema,
  portableGrowthExportSchema,
} from '@sikumi-local/core'
import { z } from 'zod'
import { toApiError } from './session'

const listSchema = z.object({
  growth: z.array(growthSnapshotSchema),
})
const oneSchema = z.object({
  growth: growthSnapshotSchema,
})

export async function listGrowth() {
  const response = await fetch('/api/growth', { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return listSchema.parse(body).growth
}

export async function getEmployeeGrowth(
  employeeId: string,
  workspaceId?: string,
) {
  const suffix = workspaceId
    ? `?workspaceId=${encodeURIComponent(workspaceId)}`
    : ''
  const response = await fetch(`/api/employees/${employeeId}/growth${suffix}`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return oneSchema.parse(body).growth
}

export async function getWorkspaceGrowth(workspaceId: string) {
  const response = await fetch(`/api/workspaces/${workspaceId}/growth`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return listSchema.parse(body).growth
}

export async function exportGrowth() {
  const response = await fetch('/api/growth?export=1', {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return z.object({ export: portableGrowthExportSchema }).parse(body).export
}
