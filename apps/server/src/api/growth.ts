import {
  growthSnapshotSchema,
  portableGrowthExportSchema,
} from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { EmployeeRegistry } from '../employees/registry.js'
import {
  exportPortableGrowth,
  listEmployeeGrowth,
  listGlobalGrowth,
  listWorkspaceGrowth,
} from '../growth/manager.js'
import type { AppStore } from '../storage/store.js'

export function registerGrowthRoutes(
  app: FastifyInstance,
  store: AppStore,
  employees: EmployeeRegistry,
): void {
  app.get('/api/growth', async (request) => {
    const exportRequested =
      typeof request.query === 'object' &&
      request.query !== null &&
      'export' in request.query &&
      request.query.export === '1'
    if (exportRequested) {
      return {
        export: portableGrowthExportSchema.parse(
          exportPortableGrowth(store, employees),
        ),
      }
    }
    return {
      growth: listGlobalGrowth(store, employees).map((item) =>
        growthSnapshotSchema.parse(item),
      ),
    }
  })

  app.get<{ Params: { id: string } }>(
    '/api/workspaces/:id/growth',
    async (request) => {
      return {
        growth: listWorkspaceGrowth(store, employees, request.params.id).map(
          (item) => growthSnapshotSchema.parse(item),
        ),
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/employees/:id/growth',
    async (request) => {
      employees.get(request.params.id)
      const workspaceId =
        typeof request.query === 'object' &&
        request.query !== null &&
        'workspaceId' in request.query &&
        typeof request.query.workspaceId === 'string'
          ? request.query.workspaceId
          : undefined
      return {
        growth: growthSnapshotSchema.parse(
          listEmployeeGrowth(store, employees, request.params.id, workspaceId),
        ),
      }
    },
  )
}
