import type { ProviderId, RuntimeProviderId } from '@sikumi-local/core'

export interface ProviderSelectionInput {
  readonly jobOverride?: RuntimeProviderId
  readonly confirmFallbackProvider?: RuntimeProviderId
  readonly employeeDefault?: ProviderId | null
  readonly workspaceDefault?: ProviderId | null
  readonly fakeHarnessEnabled: boolean
  readonly available: readonly RuntimeProviderId[]
}

export type ProviderSelectionResult =
  | {
      readonly kind: 'selected'
      readonly providerId: RuntimeProviderId
      readonly source:
        'job' | 'employee' | 'workspace' | 'confirmed-fallback' | 'fake-harness'
    }
  | {
      readonly kind: 'unavailable'
      readonly requested: RuntimeProviderId
      readonly source: 'job' | 'employee' | 'workspace' | 'confirmed-fallback'
      readonly alternatives: readonly RuntimeProviderId[]
    }
  | {
      readonly kind: 'unspecified'
      readonly alternatives: readonly RuntimeProviderId[]
    }

export function resolveProviderSelection(
  input: ProviderSelectionInput,
): ProviderSelectionResult {
  const available = input.available
  const alternatives = available.filter((id) => id !== 'fake')

  if (input.confirmFallbackProvider) {
    return decide(
      input.confirmFallbackProvider,
      'confirmed-fallback',
      input.fakeHarnessEnabled,
      available,
      alternatives,
    )
  }

  if (input.jobOverride) {
    return decide(
      input.jobOverride,
      'job',
      input.fakeHarnessEnabled,
      available,
      alternatives,
    )
  }

  if (input.employeeDefault) {
    return decide(
      input.employeeDefault,
      'employee',
      input.fakeHarnessEnabled,
      available,
      alternatives,
    )
  }

  if (input.workspaceDefault) {
    return decide(
      input.workspaceDefault,
      'workspace',
      input.fakeHarnessEnabled,
      available,
      alternatives,
    )
  }

  if (input.fakeHarnessEnabled && available.includes('fake')) {
    return {
      kind: 'selected',
      providerId: 'fake',
      source: 'fake-harness',
    }
  }

  return { kind: 'unspecified', alternatives }
}

function decide(
  requested: RuntimeProviderId,
  source: 'job' | 'employee' | 'workspace' | 'confirmed-fallback',
  fakeHarnessEnabled: boolean,
  available: readonly RuntimeProviderId[],
  alternatives: readonly RuntimeProviderId[],
): ProviderSelectionResult {
  if (requested === 'fake') {
    if (fakeHarnessEnabled && available.includes('fake')) {
      return { kind: 'selected', providerId: 'fake', source }
    }
    return { kind: 'unavailable', requested, source, alternatives }
  }

  if (available.includes(requested)) {
    return { kind: 'selected', providerId: requested, source }
  }

  return { kind: 'unavailable', requested, source, alternatives }
}
