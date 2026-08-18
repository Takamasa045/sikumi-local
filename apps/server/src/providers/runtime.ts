export function resolveFakeHarnessEnabled(
  explicit?: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (explicit !== undefined) {
    return explicit
  }
  return env.SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER === '1'
}

export function resolveLiveProviderRunsEnabled(
  explicit?: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (explicit !== undefined) {
    return explicit
  }
  if (env.SIKUMI_LOCAL_ALLOW_LIVE_PROVIDER_RUNS === '1') {
    return true
  }
  if (env.SIKUMI_LOCAL_ALLOW_LIVE_PROVIDER_RUNS === '0') {
    return false
  }
  if (env.VITEST === 'true' || env.NODE_ENV === 'test') {
    return false
  }
  return true
}

export function providerApiKeyEnvironment(
  providerId: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (providerId === 'codex' && env.OPENAI_API_KEY) {
    return { OPENAI_API_KEY: env.OPENAI_API_KEY }
  }
  if (providerId === 'grok-build' && env.XAI_API_KEY) {
    return { XAI_API_KEY: env.XAI_API_KEY }
  }
  if (providerId === 'claude-code' && env.ANTHROPIC_API_KEY) {
    return { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }
  }
  return {}
}
