import {
  AppError,
  type ProviderId,
  type RuntimeProviderId,
} from '@sikumi-local/core'
import { createClaudeProvider } from '@sikumi-local/provider-claude'
import { createCodexProvider } from '@sikumi-local/provider-codex'
import { createFakeProvider } from '@sikumi-local/provider-fake'
import { createGrokProvider } from '@sikumi-local/provider-grok'
import type {
  AgentProviderAdapter,
  ProviderProbeResult,
} from '@sikumi-local/provider-sdk'
import { DISCONNECTED_CAPABILITIES } from '@sikumi-local/provider-sdk'

export interface ProviderRegistry {
  get(id: RuntimeProviderId): AgentProviderAdapter | undefined
  listCatalog(): AgentProviderAdapter[]
  listRunnable(): AgentProviderAdapter[]
  availableIds(): RuntimeProviderId[]
  probe(id: RuntimeProviderId): Promise<ProviderProbeResult>
  probeAll(): Promise<Map<RuntimeProviderId, ProviderProbeResult>>
  ensureProbed(): Promise<void>
  cachedProbe(id: RuntimeProviderId): ProviderProbeResult | undefined
  dispose(): Promise<void>
}

export function createProviderRegistry(options: {
  readonly fakeHarnessEnabled: boolean
  readonly liveProviderRuns: boolean
  readonly adapters?: readonly AgentProviderAdapter[]
}): ProviderRegistry {
  const adapters = new Map<RuntimeProviderId, AgentProviderAdapter>()
  const probes = new Map<RuntimeProviderId, ProviderProbeResult>()

  const created = options.adapters ?? [
    createCodexProvider(),
    createGrokProvider(),
    createClaudeProvider(),
    ...(options.fakeHarnessEnabled ? [createFakeProvider()] : []),
  ]

  for (const adapter of created) {
    adapters.set(adapter.id, wrapLiveRuns(adapter, options.liveProviderRuns))
  }

  return {
    get(id) {
      return adapters.get(id)
    },

    listCatalog() {
      return [...adapters.values()].filter(
        (adapter) => adapter.advertisedAsRealProvider,
      )
    },

    listRunnable() {
      return [...adapters.values()]
    },

    availableIds() {
      const ids: RuntimeProviderId[] = []
      for (const adapter of adapters.values()) {
        const probe = probes.get(adapter.id)
        if (adapter.id === 'fake' && options.fakeHarnessEnabled) {
          ids.push('fake')
          continue
        }
        if (
          options.liveProviderRuns &&
          probe?.installed &&
          probe.authenticated &&
          probe.transport !== 'disconnected'
        ) {
          ids.push(adapter.id)
        }
      }
      return ids
    },

    async probe(id) {
      const adapter = adapters.get(id)
      if (!adapter) {
        return disconnectedProbe(['Unknown provider'])
      }
      try {
        const result = await adapter.probe()
        probes.set(id, result)
        return result
      } catch {
        const failed = disconnectedProbe(['Provider probe failed'])
        probes.set(id, failed)
        return failed
      }
    },

    async probeAll() {
      await Promise.all([...adapters.keys()].map((id) => this.probe(id)))
      return new Map(probes)
    },

    async ensureProbed() {
      const pending = [...adapters.values()]
        .filter((adapter) => !probes.has(adapter.id))
        .filter(
          (adapter) =>
            options.liveProviderRuns ||
            adapter.id === 'fake' ||
            !adapter.advertisedAsRealProvider,
        )
      await Promise.all(pending.map((adapter) => this.probe(adapter.id)))
    },

    cachedProbe(id) {
      return probes.get(id)
    },

    async dispose() {
      await Promise.all(
        [...adapters.values()].map((adapter) => adapter.dispose()),
      )
    },
  }
}

function wrapLiveRuns(
  adapter: AgentProviderAdapter,
  liveProviderRuns: boolean,
): AgentProviderAdapter {
  if (liveProviderRuns || adapter.id === 'fake') {
    return adapter
  }

  return {
    ...adapter,
    startRun() {
      return Promise.reject(disconnectedError(adapter.id as ProviderId))
    },
    resumeRun() {
      return Promise.reject(disconnectedError(adapter.id as ProviderId))
    },
  }
}

function disconnectedProbe(errors: readonly string[]): ProviderProbeResult {
  return {
    installed: false,
    authenticated: false,
    transport: 'disconnected',
    supportedFeatures: DISCONNECTED_CAPABILITIES,
    warnings: [],
    errors,
  }
}

function disconnectedError(id: ProviderId) {
  return new AppError(
    'PROVIDER_EXECUTION_DISCONNECTED',
    `${id} のライブ実行はこのプロセスでは無効です`,
    409,
  )
}
