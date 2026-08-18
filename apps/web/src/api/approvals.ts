import { approvalRequestSchema, type ApprovalRequest } from '@sikumi-local/core'
import { z } from 'zod'
import { authorizedHeaders, toApiError, writeWithCsrfRetry } from './session.js'

const approvalListSchema = z.object({
  approvals: z.array(approvalRequestSchema),
})
const approvalResponseSchema = z.object({ approval: approvalRequestSchema })

export async function listApprovals(filter?: {
  jobId?: string
  status?: ApprovalRequest['status']
}): Promise<ApprovalRequest[]> {
  const params = new URLSearchParams()
  if (filter?.jobId) {
    params.set('jobId', filter.jobId)
  }
  if (filter?.status) {
    params.set('status', filter.status)
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  const response = await fetch(`/api/approvals${suffix}`, {
    credentials: 'include',
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return approvalListSchema.parse(body).approvals
}

export async function resolveApproval(
  id: string,
  decision: 'approved' | 'denied',
): Promise<ApprovalRequest> {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/approvals/${id}/resolve`, {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({ decision }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return approvalResponseSchema.parse(body).approval
}
