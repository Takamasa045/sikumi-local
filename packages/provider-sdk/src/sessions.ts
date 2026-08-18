import type { PermissionProfileId, RuntimeProviderId } from '@sikumi-local/core'

export interface ProviderRunSpecification {
  readonly runId: string
  readonly workspaceId: string
  readonly employeeId: string
  readonly cwd: string
  readonly prompt: string
  readonly model?: string
  readonly permissionProfile: PermissionProfileId
  readonly outputSchema?: Record<string, unknown>
  readonly providerSessionId?: string
  readonly maxDurationMs?: number
  readonly maxTurns?: number
  readonly maxBudgetUsd?: number
  readonly environment: Record<string, string>
  readonly allowedCwdRoots: readonly string[]
}

export interface ProviderResumeSpecification extends ProviderRunSpecification {
  readonly providerSessionId: string
}

export interface UserAnswer {
  readonly text: string
}

export interface ProviderRunHandle {
  readonly runId: string
  readonly providerId: RuntimeProviderId | 'fake'
  events(): AsyncIterable<import('./events.js').CanonicalEvent>
  cancel(): Promise<void>
}
