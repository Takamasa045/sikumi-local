import {
  AppError,
  registerWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceSchema,
} from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { AppStore } from '../storage/store.js'
import { writeRegisteredRepositoryCatalog } from '@sikumi-local/observer-claude-desktop'
import { registerWorkspace } from '../workspaces/register-workspace.js'

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  store: AppStore,
  options: { readonly dataDirectory?: string } = {},
): void {
  app.get('/api/workspaces', async () => ({
    workspaces: store.listWorkspaces(),
  }))

  app.get<{ Params: { id: string } }>(
    '/api/workspaces/:id',
    async (request, reply) => {
      const workspace = store.getWorkspace(request.params.id)
      if (!workspace) {
        throw new AppError('NOT_FOUND', 'Workspaceが見つかりません', 404)
      }
      return reply.send({ workspace })
    },
  )

  app.post('/api/workspaces', async (request, reply) => {
    const parsed = registerWorkspaceRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Repository path is required',
        400,
      )
    }

    const workspace = workspaceSchema.parse(
      registerWorkspace(store, parsed.data.path, parsed.data.employeeName),
    )
    if (options.dataDirectory) {
      writeRegisteredRepositoryCatalog(
        options.dataDirectory,
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
    return reply.status(201).send({ workspace })
  })

  app.patch<{ Params: { id: string } }>(
    '/api/workspaces/:id',
    async (request) => {
      const parsed = updateWorkspaceRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Workspace update is invalid',
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
}
