import {
  AppError,
  isProviderId,
  isRuntimeProviderId,
  providerSchema,
  updateProviderSettingsRequestSchema,
} from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { ProviderRegistry } from '../providers/registry.js'
import type { AppStore } from '../storage/store.js'

export function registerProviderRoutes(
  app: FastifyInstance,
  store: AppStore,
  registry: ProviderRegistry,
  options: { readonly liveProviderRuns: boolean },
): void {
  app.get('/api/providers', async () => {
    await registry.ensureProbed()
    const catalog = store.listProviders().map((provider) => {
      const probe = registry.cachedProbe(provider.id)
      const connected = Boolean(
        options.liveProviderRuns &&
        probe?.installed &&
        probe.authenticated &&
        probe.transport !== 'disconnected' &&
        registry.get(provider.id),
      )
      return providerSchema.parse({
        ...provider,
        executionConnected: connected,
      })
    })
    return {
      providers: catalog,
      executionConnected: catalog.some(
        (provider) => provider.executionConnected,
      ),
      fakeHarness: Boolean(registry.get('fake')),
    }
  })

  app.get<{ Params: { id: string } }>('/api/providers/:id', async (request) => {
    const id = request.params.id
    if (!isRuntimeProviderId(id) && !isProviderId(id)) {
      throw new AppError('NOT_FOUND', '実行エンジンが見つかりません', 404)
    }
    const adapter = registry.get(id)
    if (!adapter || !adapter.advertisedAsRealProvider) {
      throw new AppError('NOT_FOUND', '実行エンジンが見つかりません', 404)
    }
    const probe = registry.cachedProbe(id) ?? (await registry.probe(id))
    return {
      provider: {
        id: adapter.id,
        displayName: adapter.displayName,
        executionConnected: Boolean(
          options.liveProviderRuns &&
          probe.installed &&
          probe.authenticated &&
          probe.transport !== 'disconnected',
        ),
        probe,
      },
    }
  })

  app.post<{ Params: { id: string } }>(
    '/api/providers/:id/probe',
    async (request) => {
      const id = request.params.id
      if (!isRuntimeProviderId(id)) {
        throw new AppError('NOT_FOUND', '実行エンジンが見つかりません', 404)
      }
      const probe = await registry.probe(id)
      return { id, probe }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/providers/:id/models',
    async (request) => {
      const id = request.params.id
      if (!isRuntimeProviderId(id)) {
        throw new AppError('NOT_FOUND', '実行エンジンが見つかりません', 404)
      }
      const adapter = registry.get(id)
      if (!adapter) {
        throw new AppError('NOT_FOUND', '実行エンジンが見つかりません', 404)
      }
      return { models: await adapter.listModels() }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/providers/:id/settings',
    async (request) => {
      const id = request.params.id
      if (!isProviderId(id)) {
        throw new AppError('NOT_FOUND', '実行エンジンが見つかりません', 404)
      }
      const parsed = updateProviderSettingsRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Provider settings are invalid',
          400,
        )
      }
      const setting = store.insertProviderSetting({
        id: `${parsed.data.workspaceId}:${id}`,
        workspaceId: parsed.data.workspaceId,
        providerId: id,
        selectedModel: parsed.data.selectedModel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      return { setting }
    },
  )
}
