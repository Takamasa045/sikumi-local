import { describe, expect, it } from 'vitest'
import {
  providerApiKeyEnvironment,
  resolveFakeHarnessEnabled,
  resolveLiveProviderRunsEnabled,
} from './runtime.js'

describe('provider runtime flags', () => {
  it('enables fake only with the explicit env and blocks live runs under Vitest', () => {
    expect(resolveFakeHarnessEnabled(undefined, {})).toBe(false)
    expect(
      resolveFakeHarnessEnabled(undefined, {
        SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER: '1',
      }),
    ).toBe(true)
    expect(resolveLiveProviderRunsEnabled(undefined, { VITEST: 'true' })).toBe(
      false,
    )
    expect(
      resolveLiveProviderRunsEnabled(undefined, {
        SIKUMI_LOCAL_ALLOW_LIVE_PROVIDER_RUNS: '1',
      }),
    ).toBe(true)
    expect(providerApiKeyEnvironment('codex', { OPENAI_API_KEY: 'k' })).toEqual(
      {
        OPENAI_API_KEY: 'k',
      },
    )
    expect(providerApiKeyEnvironment('grok-build', {})).toEqual({})
    expect(
      resolveLiveProviderRunsEnabled(undefined, {
        SIKUMI_LOCAL_ALLOW_LIVE_PROVIDER_RUNS: '0',
      }),
    ).toBe(false)
    expect(
      providerApiKeyEnvironment('grok-build', { XAI_API_KEY: 'x' }),
    ).toEqual({ XAI_API_KEY: 'x' })
    expect(
      providerApiKeyEnvironment('claude-code', { ANTHROPIC_API_KEY: 'a' }),
    ).toEqual({ ANTHROPIC_API_KEY: 'a' })
  })
})
