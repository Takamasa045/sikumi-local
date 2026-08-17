import type { FastifyInstance } from 'fastify'
import { createSessionCookie } from '../security/http-guard.js'

export function registerSessionRoutes(
  app: FastifyInstance,
  sessionToken: string,
): void {
  app.get('/api/session', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    reply.header('Set-Cookie', createSessionCookie(sessionToken))
    return { token: sessionToken }
  })
}
