import {
  AppError,
  confirmWriteRequestSchema,
  gardenWorldListSchema,
  installPackRequestSchema,
  installedPackSchema,
  packPreviewSchema,
  previewPackRequestSchema,
} from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { EmployeeRegistry } from '../employees/registry.js'
import {
  ensureBuiltinPacks,
  installPackPreview,
  previewPack,
  uninstallPack,
} from '../packs/manager.js'
import {
  listInstalledGardenWorlds,
  readWorldPackAsset,
} from '../packs/world-pack.js'
import type { AppStore } from '../storage/store.js'

export function registerPackRoutes(
  app: FastifyInstance,
  store: AppStore,
  employees: EmployeeRegistry,
  dataDirectory: string,
): void {
  app.get('/api/packs', async () => {
    ensureBuiltinPacks(store, employees)
    return {
      packs: store.listPacks().map((pack) => installedPackSchema.parse(pack)),
    }
  })

  app.post('/api/packs/preview', async (request, reply) => {
    const parsed = previewPackRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'Pack preview is invalid', 400)
    }
    const preview = packPreviewSchema.parse(
      previewPack({
        store,
        dataDirectory,
        sourceType: parsed.data.sourceType,
        ...(parsed.data.path ? { path: parsed.data.path } : {}),
        ...(parsed.data.gitUrl ? { gitUrl: parsed.data.gitUrl } : {}),
      }),
    )
    return reply.status(201).send({ preview })
  })

  app.post('/api/packs/install', async (request, reply) => {
    const parsed = installPackRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Pack install requires an explicit confirm',
        400,
      )
    }
    const pack = installedPackSchema.parse(
      installPackPreview({
        store,
        employees,
        dataDirectory,
        previewId: parsed.data.previewId,
        confirm: parsed.data.confirm,
      }),
    )
    return reply.status(201).send({ pack })
  })

  app.delete<{ Params: { id: string } }>('/api/packs/:id', async (request) => {
    const parsed = confirmWriteRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Pack uninstall requires an explicit confirm',
        400,
      )
    }
    uninstallPack({
      store,
      employees,
      dataDirectory,
      packRowId: request.params.id,
      confirm: parsed.data.confirm,
    })
    return { ok: true }
  })

  app.get('/api/worlds', async () => {
    ensureBuiltinPacks(store, employees)
    return gardenWorldListSchema.parse({
      worlds: listInstalledGardenWorlds(store, dataDirectory),
    })
  })

  app.get<{
    Params: { packId: string; file: string }
    Querystring: { v?: string }
  }>(
    '/api/worlds/:packId/assets/:file',
    async (request, reply) => {
      const asset = readWorldPackAsset({
        store,
        dataDirectory,
        packId: request.params.packId,
        file: request.params.file,
      })
      const installedVersion = store.findPack(
        'world',
        request.params.packId,
      )?.version
      const hasCurrentVersion =
        request.query.v !== undefined && request.query.v === installedVersion
      return reply
        .type(asset.contentType)
        .header(
          'Cache-Control',
          hasCurrentVersion
            ? 'private, max-age=31536000, immutable'
            : 'private, no-cache',
        )
        .send(asset.body)
    },
  )
}
