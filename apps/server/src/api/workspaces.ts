import {
  AppError,
  chooseWorkspaceFolderResponseSchema,
  registerWorkspaceRequestSchema,
  unregisterWorkspaceResponseSchema,
  updateWorkspaceRequestSchema,
  workspaceSchema,
} from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { AppStore } from '../storage/store.js'
import { writeRegisteredRepositoryCatalog } from '@sikumi-local/observer-claude-desktop'
import {
  chooseLocalFolder,
  type FolderChoice,
} from '../workspaces/choose-folder.js'
import { registerWorkspace } from '../workspaces/register-workspace.js'

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  store: AppStore,
  options: {
    readonly dataDirectory?: string
    readonly chooseFolder?: () => Promise<FolderChoice>
  } = {},
): void {
  app.get('/api/workspaces', async () => ({
    workspaces: store.listWorkspaces(),
  }))

  app.get<{ Params: { id: string } }>(
    '/api/workspaces/:id',
    async (request, reply) => {
      const workspace = store.getWorkspace(request.params.id)
      if (!workspace) {
        throw new AppError('NOT_FOUND', '場所が見つかりません', 404)
      }
      return reply.send({ workspace })
    },
  )

  app.post('/api/workspaces/choose-folder', async () => {
    const picker = options.chooseFolder ?? chooseLocalFolder
    return chooseWorkspaceFolderResponseSchema.parse(await picker())
  })

  app.post('/api/workspaces', async (request, reply) => {
    const parsed = registerWorkspaceRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        '観測する場所のパスが必要です',
        400,
      )
    }

    const workspace = workspaceSchema.parse(
      registerWorkspace(store, parsed.data.path, parsed.data.employeeName),
    )
    syncRegisteredCatalog(store, options.dataDirectory)
    return reply.status(201).send({ workspace })
  })

  app.patch<{ Params: { id: string } }>(
    '/api/workspaces/:id',
    async (request) => {
      const parsed = updateWorkspaceRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          '場所の更新内容が正しくありません',
          400,
        )
      }
      return {
        workspace: workspaceSchema.parse(
          store.updateWorkspace(request.params.id, {
            ...(parsed.data.defaultProviderId === undefined
              ? {}
              : { defaultProviderId: parsed.data.defaultProviderId }),
            ...(parsed.data.employeeName === undefined
              ? {}
              : { employeeName: parsed.data.employeeName }),
          }),
        ),
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/workspaces/:id',
    async (request) => {
      store.deleteWorkspace(request.params.id)
      syncRegisteredCatalog(store, options.dataDirectory)
      return unregisterWorkspaceResponseSchema.parse({ ok: true })
    },
  )
}

function syncRegisteredCatalog(
  store: AppStore,
  dataDirectory: string | undefined,
): void {
  if (!dataDirectory) {
    return
  }
  writeRegisteredRepositoryCatalog(
    dataDirectory,
    store
      .listWorkspaces()
      .filter(
        (workspace) =>
          !workspace.repository.absolutePath.startsWith('unlinked:'),
      )
      .map((workspace) => ({
        id: workspace.repository.id,
        displayName: workspace.repository.displayName,
        absolutePath: workspace.repository.absolutePath,
      })),
  )
}
