import type { RuntimeProviderId } from '@sikumi-local/core'
import type { ApprovalDecision } from './approvals.js'
import type {
  ModelOption,
  ProviderAuthStatus,
  ProviderCapabilities,
  ProviderProbeResult,
} from './capabilities.js'
import type {
  ProviderResumeSpecification,
  ProviderRunHandle,
  ProviderRunSpecification,
  UserAnswer,
} from './sessions.js'

export interface AgentProviderAdapter {
  readonly id: RuntimeProviderId
  readonly displayName: string
  readonly advertisedAsRealProvider: boolean

  probe(): Promise<ProviderProbeResult>
  getAuthStatus(): Promise<ProviderAuthStatus>
  listModels(): Promise<ModelOption[]>
  getCapabilities(): Promise<ProviderCapabilities>

  startRun(specification: ProviderRunSpecification): Promise<ProviderRunHandle>
  resumeRun(
    specification: ProviderResumeSpecification,
  ): Promise<ProviderRunHandle>
  respondToApproval(
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<void>
  respondToQuestion(requestId: string, answer: UserAnswer): Promise<void>
  cancelRun(runId: string): Promise<void>
  dispose(): Promise<void>
}
