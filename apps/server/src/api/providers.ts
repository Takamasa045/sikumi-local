import type { FastifyInstance } from 'fastify'
import type { AppStore } from '../storage/store.js'

export function registerProviderRoutes(
  app: FastifyInstance,
  store: AppStore,
): void {
  app.get('/api/providers', async () => ({
    providers: store.listProviders(),
    executionConnected: false,
  }))
}
