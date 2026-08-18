import {
  AppError,
  employeeSummarySchema,
  jobSchema,
  updateEmployeeRequestSchema,
} from '@sikumi-local/core'
import type { FastifyInstance } from 'fastify'
import type { EmployeeRegistry } from '../employees/registry.js'
import type { AppStore } from '../storage/store.js'

export function registerEmployeeRoutes(
  app: FastifyInstance,
  store: AppStore,
  employees: EmployeeRegistry,
): void {
  app.get('/api/employees', async () => {
    employees.refresh()
    employees.syncToStore(store)
    return {
      employees: employees
        .list()
        .map((employee) =>
          employeeSummarySchema.parse(withStoredDefault(store, employee)),
        ),
    }
  })

  app.get<{ Params: { id: string } }>('/api/employees/:id', async (request) => {
    employees.refresh()
    employees.syncToStore(store)
    const employee = withStoredDefault(store, employees.get(request.params.id))
    const pack = employees.getPack(employee.id)
    const recentJobs = store
      .listJobs()
      .filter((job) => job.employeeId === employee.id)
      .slice(0, 8)
      .map((job) => jobSchema.parse(job))
    return {
      employee: employeeSummarySchema.parse(employee),
      stateMap: pack.stateMap,
      growth: pack.growth,
      recentJobs,
    }
  })

  app.patch<{ Params: { id: string } }>(
    '/api/employees/:id',
    async (request) => {
      const parsed = updateEmployeeRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Employee update is invalid',
          400,
        )
      }
      employees.refresh()
      employees.syncToStore(store)
      employees.get(request.params.id)
      const updated = store.updateEmployee(request.params.id, {
        defaultProviderId: parsed.data.defaultProviderId,
      })
      return {
        employee: employeeSummarySchema.parse(
          withStoredDefault(store, {
            ...employees.get(request.params.id),
            defaultProviderId: updated.defaultProviderId,
            updatedAt: updated.updatedAt,
          }),
        ),
      }
    },
  )
}

function withStoredDefault(
  store: AppStore,
  employee: ReturnType<EmployeeRegistry['get']>,
) {
  const stored = store.getEmployee(employee.id)
  return {
    ...employee,
    defaultProviderId: stored?.defaultProviderId ?? employee.defaultProviderId,
    createdAt: stored?.createdAt ?? employee.createdAt,
    updatedAt: stored?.updatedAt ?? employee.updatedAt,
  }
}
