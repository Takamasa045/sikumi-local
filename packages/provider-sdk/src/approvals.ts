import { AppError, type ApprovalRisk } from '@sikumi-local/core'

export const approvalDecisions = ['approved', 'denied'] as const
export type ApprovalDecision = (typeof approvalDecisions)[number]

export interface ApprovalModel {
  readonly requestId: string
  readonly risk: ApprovalRisk
  readonly summary: string
}

export function parseApprovalDecision(value: string): ApprovalDecision {
  if (value === 'approved' || value === 'denied') {
    return value
  }
  throw new AppError('VALIDATION_FAILED', 'Unknown approval decision', 400)
}

export function isApprovalDecision(value: string): value is ApprovalDecision {
  return value === 'approved' || value === 'denied'
}
