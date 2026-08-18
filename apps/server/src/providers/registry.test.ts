import { describe, expect, it } from 'vitest'
import { createFakeProvider } from '@sikumi-local/provider-fake'
import type { AgentProviderAdapter } from '@sikumi-local/provider-sdk'
import { DISCONNECTED_CAPABILITIES } from '@sikumi-local/provider-sdk'
import { createProviderRegistry } from './registry.js'

describe('provider registry', () => {
  it('hides fake from the catalog and only lists it when the harness is on', async () => {
    const registry = createProviderRegistry({
      fakeHarnessEnabled: true,
      liveProviderRuns: false,
      adapters: [createFakeProvider()],
    })
    expect(registry.listCatalog()).toEqual([])
    expect(registry.availableIds()).toEqual(['fake'])
    const probe = await registry.probe('fake')
    expect(probe.transport).toBe('fake')
    expect(registry.cachedProbe('fake')?.installed).toBe(true)
    await registry.dispose()
  })

  it('isolates a failing probe and probes remaining providers in parallel', async () => {
    const seen: string[] = []
    const boom = stubAdapter('codex', async () => {
      seen.push('codex')
      throw new Error('secret-token-should-not-leak')
    })
    const ok = stubAdapter('grok-build', async () => {
      seen.push('grok-build')
      return {
        installed: true,
        authenticated: true,
        transport: 'acp' as const,
        supportedFeatures: DISCONNECTED_CAPABILITIES,
        warnings: [],
        errors: [],
      }
    })
    const registry = createProviderRegistry({
      fakeHarnessEnabled: false,
      liveProviderRuns: true,
      adapters: [boom, ok],
    })

    expect(registry.availableIds()).toEqual([])
    const all = await registry.probeAll()
    expect(seen.sort()).toEqual(['codex', 'grok-build'])
    expect(all.get('codex')).toMatchObject({
      installed: false,
      authenticated: false,
      transport: 'disconnected',
    })
    expect(JSON.stringify([...all.values()])).not.toContain(
      'secret-token-should-not-leak',
    )
    expect(all.get('grok-build')?.authenticated).toBe(true)
    expect(registry.availableIds()).toEqual(['grok-build'])
    await registry.ensureProbed()
    await registry.dispose()
  })

  it('does not probe real CLIs while live runs are disconnected', async () => {
    let probes = 0
    const registry = createProviderRegistry({
      fakeHarnessEnabled: true,
      liveProviderRuns: false,
      adapters: [
        stubAdapter('codex', async () => {
          probes += 1
          throw new Error('should not probe')
        }),
        createFakeProvider(),
      ],
    })
    await registry.ensureProbed()
    expect(probes).toBe(0)
    expect(registry.cachedProbe('fake')?.transport).toBe('fake')
    expect(registry.cachedProbe('codex')).toBeUndefined()
    await registry.dispose()
  })
})

function stubAdapter(
  id: 'codex' | 'grok-build' | 'claude-code',
  probe: AgentProviderAdapter['probe'],
): AgentProviderAdapter {
  return {
    id,
    displayName: id,
    advertisedAsRealProvider: true,
    probe,
    async getAuthStatus() {
      return { authenticated: false, description: 'fixture' }
    },
    async listModels() {
      return []
    },
    async getCapabilities() {
      return DISCONNECTED_CAPABILITIES
    },
    async startRun() {
      throw new Error('unused')
    },
    async resumeRun() {
      throw new Error('unused')
    },
    async respondToApproval() {},
    async respondToQuestion() {},
    async cancelRun() {},
    async dispose() {},
  }
}
