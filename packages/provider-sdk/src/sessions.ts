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
  readonly providerSessionId?: string
  events(): AsyncIterable<import('./events.js').CanonicalEvent>
  cancel(): Promise<void>
}

export function createProviderRunHandle(input: {
  readonly runId: string
  readonly providerId: RuntimeProviderId | 'fake'
  readonly getSessionId?: () => string | undefined
  readonly events: () => AsyncIterable<import('./events.js').CanonicalEvent>
  readonly cancel: () => Promise<void>
}): ProviderRunHandle {
  const handle: ProviderRunHandle = {
    runId: input.runId,
    providerId: input.providerId,
    events: input.events,
    cancel: input.cancel,
  }
  if (input.getSessionId) {
    Object.defineProperty(handle, 'providerSessionId', {
      enumerable: true,
      configurable: true,
      get: input.getSessionId,
    })
  }
  return handle
}
