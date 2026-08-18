import { AppError, isAppError } from '@sikumi-local/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { registerApprovalRoutes } from './api/approvals.js'
import { registerArtifactRoutes } from './api/artifacts.js'
import { registerJobRoutes } from './api/jobs.js'
import { registerProviderRoutes } from './api/providers.js'
import { registerSessionRoutes } from './api/session.js'
import { registerWorkspaceRoutes } from './api/workspaces.js'
import { createJobManager } from './jobs/job-manager.js'
import { resolveFakeHarnessEnabled } from './providers/runtime.js'
import {
  createRequestGuard,
  DEFAULT_BODY_LIMIT_BYTES,
  resolveSecurityConfig,
  type SecurityOptions,
} from './security/http-guard.js'
import { openDatabase } from './storage/database.js'
import { createStore } from './storage/store.js'

export interface AppOptions {
  readonly dataDirectory: string
  readonly security?: SecurityOptions
  readonly enableFakeProvider?: boolean
}

export function buildApp(options: AppOptions): FastifyInstance {
  const { sqlite, db } = openDatabase(options.dataDirectory)
  const store = createStore(db)
  const security = resolveSecurityConfig(options.security)
  const assertRequestAllowed = createRequestGuard(security)
  const fakeHarnessEnabled = resolveFakeHarnessEnabled(
    options.enableFakeProvider,
  )
  const jobs = createJobManager(store, { fakeHarnessEnabled })
  const app = Fastify({
    logger: false,
    bodyLimit: options.security?.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
  })

  app.addHook('onClose', async () => {
    await jobs.dispose()
    sqlite.close()
  })

  app.addHook('onRequest', async (request) => {
    assertRequestAllowed(request)
  })

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      })
    }

    if (isPayloadTooLarge(error)) {
      return reply.status(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large',
        },
      })
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
        },
      })
    }

    app.log.error(error)
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error',
      },
    })
  })

  app.get('/api/health', async () => ({
    ok: true,
    product: 'Shikumi Local',
    phase: 'provider-sdk-and-fake',
    bind: '127.0.0.1',
    persistence: 'sqlite',
    providerExecution: 'disconnected',
    fakeHarness: fakeHarnessEnabled,
  }))

  registerSessionRoutes(app, security.sessionToken)
  registerWorkspaceRoutes(app, store)
  registerProviderRoutes(app, store)
  registerJobRoutes(app, jobs)
  registerApprovalRoutes(app, jobs)
  registerArtifactRoutes(app, jobs)

  return app
}

function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as { statusCode?: number; code?: string }
  return (
    candidate.statusCode === 413 ||
    candidate.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
  )
}

export { AppError }
