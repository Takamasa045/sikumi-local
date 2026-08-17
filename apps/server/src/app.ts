import Fastify, { type FastifyInstance } from 'fastify'

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/api/health', async () => ({
    ok: true,
    product: 'Shikumi Local',
    phase: 'repository-foundation',
    bind: '127.0.0.1',
  }))

  return app
}
