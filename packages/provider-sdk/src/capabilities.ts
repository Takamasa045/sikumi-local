export interface ProviderCapabilities {
  readonly streaming: boolean
  readonly structuredOutput: boolean
  readonly sessionResume: boolean
  readonly interruption: boolean
  readonly liveApprovals: boolean
  readonly liveQuestions: boolean
  readonly readOnlySandbox: boolean
  readonly workspaceWriteSandbox: boolean
  readonly networkControl: boolean
  readonly nativeWorktree: boolean
  readonly modelListing: boolean
  readonly usageReporting: boolean
  readonly costReporting: boolean
}

export interface ProviderProbeResult {
  readonly installed: boolean
  readonly commandPath?: string
  readonly version?: string
  readonly authenticated: boolean
  readonly authDescription?: string
  readonly supportedFeatures: ProviderCapabilities
  readonly warnings: readonly string[]
  readonly errors: readonly string[]
}

export interface ProviderAuthStatus {
  readonly authenticated: boolean
  readonly description: string
}

export interface ModelOption {
  readonly id: string
  readonly displayName: string
}

export const DISCONNECTED_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  structuredOutput: false,
  sessionResume: false,
  interruption: false,
  liveApprovals: false,
  liveQuestions: false,
  readOnlySandbox: false,
  workspaceWriteSandbox: false,
  networkControl: false,
  nativeWorktree: false,
  modelListing: false,
  usageReporting: false,
  costReporting: false,
}

export function capabilitiesMissing(
  required: readonly (keyof ProviderCapabilities)[],
  actual: ProviderCapabilities,
): Array<keyof ProviderCapabilities> {
  return required.filter((key) => !actual[key])
}
