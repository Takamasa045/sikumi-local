import {
  employeeSummarySchema,
  jobSchema,
  type EmployeeSummary,
  type Job,
  type ProviderId,
} from '@sikumi-local/core'
import { z } from 'zod'
import { authorizedHeaders, toApiError, writeWithCsrfRetry } from './session.js'

const listSchema = z.object({
  employees: z.array(employeeSummarySchema),
})

const detailSchema = z.object({
  employee: employeeSummarySchema,
  recentJobs: z.array(jobSchema),
  stateMap: z.object({
    states: z.record(
      z.string(),
      z.object({
        station: z.string(),
        pose: z.string(),
        summary: z.string(),
      }),
    ),
    eventBindings: z.record(z.string(), z.string()),
  }),
})

export async function listEmployees(): Promise<EmployeeSummary[]> {
  const response = await fetch('/api/employees', { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return listSchema.parse(body).employees
}

export async function getEmployee(id: string): Promise<{
  employee: EmployeeSummary
  recentJobs: Job[]
  stateMap: {
    states: Record<string, { station: string; pose: string; summary: string }>
    eventBindings: Record<string, string>
  }
}> {
  const response = await fetch(`/api/employees/${id}`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return detailSchema.parse(body)
}

export async function updateEmployeeDefaultProvider(
  id: string,
  defaultProviderId: ProviderId | null,
): Promise<EmployeeSummary> {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/employees/${id}`, {
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
  return z.object({ employee: employeeSummarySchema }).parse(body).employee
}
