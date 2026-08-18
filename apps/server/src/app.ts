import {
  AppError,
  isAppError,
  redactSensitiveText,
  sanitizeEventPayload,
} from '@sikumi-local/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { registerApprovalRoutes } from './api/approvals.js'
import { registerArtifactRoutes } from './api/artifacts.js'
import { registerEmployeeRoutes } from './api/employees.js'
import { registerEventRoutes } from './api/events.js'
import { registerGrowthRoutes } from './api/growth.js'
import { registerJobRoutes } from './api/jobs.js'
import { registerPackRoutes } from './api/packs.js'
import { registerProviderRoutes } from './api/providers.js'
import { registerSessionRoutes } from './api/session.js'
import { registerWorkspaceRoutes } from './api/workspaces.js'
import { createEmployeeRegistry } from './employees/registry.js'
import { ensureBuiltinPacks } from './packs/manager.js'
import { createJobManager } from './jobs/job-manager.js'
import {
  createProviderRegistry,
  type ProviderRegistry,
} from './providers/registry.js'
import {
  resolveFakeHarnessEnabled,
  resolveLiveProviderRunsEnabled,
} from './providers/runtime.js'
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
  readonly liveProviderRuns?: boolean
  readonly registry?: ProviderRegistry
}

export function buildApp(options: AppOptions): FastifyInstance {
  const { sqlite, db } = openDatabase(options.dataDirectory)
  const store = createStore(db)
  const security = resolveSecurityConfig(options.security)
  const assertRequestAllowed = createRequestGuard(security)
  const fakeHarnessEnabled = resolveFakeHarnessEnabled(
    options.enableFakeProvider,
  )
  const liveProviderRuns = resolveLiveProviderRunsEnabled(
    options.liveProviderRuns,
  )
  const registry =
    options.registry ??
    createProviderRegistry({
      fakeHarnessEnabled,
      liveProviderRuns,
    })
  const employees = createEmployeeRegistry({
    dataDirectory: options.dataDirectory,
  })
  employees.refresh()
  employees.syncToStore(store)
  ensureBuiltinPacks(store, employees)
  const jobs = createJobManager(store, {
    fakeHarnessEnabled,
    liveProviderRuns,
    registry,
    employees,
    dataDirectory: options.dataDirectory,
  })
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
        error: {
          code: error.code,
          message: redactSensitiveText(error.message),
        },
        ...(error.details
          ? { details: sanitizeEventPayload({ ...error.details }) }
          : {}),
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
    phase: 'employee-garden',
    bind: '127.0.0.1',
    persistence: 'sqlite',
    providerExecution: liveProviderRuns ? 'registry' : 'disconnected',
    fakeHarness: fakeHarnessEnabled,
    liveProviderRuns,
  }))

  app.get('/api/doctor', async () => {
    const probes = await registry.probeAll()
    return {
      bind: '127.0.0.1',
      fakeHarness: fakeHarnessEnabled,
      liveProviderRuns,
      providers: [...probes.entries()].map(([id, probe]) => ({
        id,
        ...probe,
      })),
    }
  })

  registerSessionRoutes(app, security.sessionToken)
  registerWorkspaceRoutes(app, store)
  registerProviderRoutes(app, store, registry, { liveProviderRuns })
  registerEmployeeRoutes(app, store, employees)
  registerJobRoutes(app, jobs, security)
  registerEventRoutes(app, jobs, security)
  registerApprovalRoutes(app, jobs)
  registerArtifactRoutes(app, jobs)
  registerGrowthRoutes(app, store, employees)
  registerPackRoutes(app, store, employees, options.dataDirectory)

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
