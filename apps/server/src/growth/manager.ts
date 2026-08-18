import { randomUUID } from 'node:crypto'
import {
  AppError,
  type GrowthRecord,
  type Job,
  type PermissionProfileId,
} from '@sikumi-local/core'
import type { EmployeeGrowthDefinition } from '@sikumi-local/employee-sdk'
import type { EmployeeRegistry } from '../employees/registry.js'
import type { AppStore } from '../storage/store.js'
import { builtInWorlds } from './worlds.js'

export interface GrowthView {
  readonly employeeId: string
  readonly employeeName: string
  readonly workspaceId: string | null
  readonly level: number
  readonly permissionProfile: PermissionProfileId
  readonly metrics: readonly { id: string; label: string; value: number }[]
  readonly unlocks: readonly string[]
}

export function applyJobGrowth(input: {
  readonly store: AppStore
  readonly employees: EmployeeRegistry
  readonly job: Job
}): void {
  const employee = input.store.getEmployee(input.job.employeeId)
  if (!employee) {
    return
  }
  const pack = safePack(input.employees, input.job.employeeId)
  const now = new Date().toISOString()
  const increments = resolveIncrements(input.job, pack?.growth)
  for (const increment of increments) {
    applyOnce({
      store: input.store,
      jobId: increment.jobId ?? input.job.id,
      employeeId: input.job.employeeId,
      scopeKey: 'global',
      workspaceId: null,
      metric: increment.metric,
      value: increment.value,
      createdAt: now,
    })
    applyOnce({
      store: input.store,
      jobId: increment.jobId ?? input.job.id,
      employeeId: input.job.employeeId,
      scopeKey: input.job.workspaceId,
      workspaceId: input.job.workspaceId,
      metric: increment.metric,
      value: increment.value,
      createdAt: now,
    })
  }
  refreshWorldUnlocks(input.store, input.job.workspaceId)
}

export function applyAcceptedArtifactGrowth(input: {
  readonly store: AppStore
  readonly job: Job
}): void {
  const now = new Date().toISOString()
  applyOnce({
    store: input.store,
    jobId: `accepted:${input.job.id}`,
    employeeId: input.job.employeeId,
    scopeKey: 'global',
    workspaceId: null,
    metric: 'accepted_artifacts',
    value: 1,
    createdAt: now,
  })
  applyOnce({
    store: input.store,
    jobId: `accepted:${input.job.id}`,
    employeeId: input.job.employeeId,
    scopeKey: input.job.workspaceId,
    workspaceId: input.job.workspaceId,
    metric: 'accepted_artifacts',
    value: 1,
    createdAt: now,
  })
  refreshWorldUnlocks(input.store, input.job.workspaceId)
}

export function listEmployeeGrowth(
  store: AppStore,
  employees: EmployeeRegistry,
  employeeId: string,
  workspaceId?: string,
): GrowthView {
  const summary = employees.get(employeeId)
  const stored = store.getEmployee(employeeId)
  const pack = safePack(employees, employeeId)
  const records = store
    .listGrowthRecords({ employeeId })
    .filter((record) =>
      workspaceId === undefined
        ? record.workspaceId === null
        : record.workspaceId === workspaceId,
    )
  const metrics = summarizeMetrics(records, pack?.growth)
  return {
    employeeId,
    employeeName: stored?.name ?? summary.name,
    workspaceId: workspaceId ?? null,
    level: resolveLevel(sumPrimary(metrics), pack?.growth),
    permissionProfile: summary.permissionProfile,
    metrics,
    unlocks: workspaceId
      ? store
          .listWorldFeatureUnlocks(workspaceId)
          .map((unlock) => unlock.unlockId)
      : [],
  }
}

export function listWorkspaceGrowth(
  store: AppStore,
  employees: EmployeeRegistry,
  workspaceId: string,
): GrowthView[] {
  const workspace = store.getWorkspace(workspaceId)
  if (!workspace) {
    throw new AppError('NOT_FOUND', 'Workspaceが見つかりません', 404)
  }
  return employees
    .list()
    .map((employee) =>
      listEmployeeGrowth(store, employees, employee.id, workspaceId),
    )
}

export function listGlobalGrowth(
  store: AppStore,
  employees: EmployeeRegistry,
): GrowthView[] {
  return employees
    .list()
    .map((employee) => listEmployeeGrowth(store, employees, employee.id))
}

export function exportPortableGrowth(
  store: AppStore,
  employees: EmployeeRegistry,
) {
  return {
    generatedAt: new Date().toISOString(),
    employees: employees.list().map((employee) => {
      const global = listEmployeeGrowth(store, employees, employee.id)
      return {
        employeeId: employee.id,
        employeeName: employee.name,
        level: global.level,
        metrics: [...global.metrics],
        workspaces: store.listWorkspaces().map((workspace) => {
          const local = listEmployeeGrowth(
            store,
            employees,
            employee.id,
            workspace.id,
          )
          return {
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            level: local.level,
            metrics: [...local.metrics],
            unlocks: [...local.unlocks],
          }
        }),
      }
    }),
  }
}

function applyOnce(input: {
  readonly store: AppStore
  readonly jobId: string
  readonly employeeId: string
  readonly scopeKey: string
  readonly workspaceId: string | null
  readonly metric: string
  readonly value: number
  readonly createdAt: string
}): void {
  input.store.recordGrowthOnce({
    application: {
      id: randomUUID(),
      jobId: input.jobId,
      employeeId: input.employeeId,
      scopeKey: input.scopeKey,
      metric: input.metric,
      value: input.value,
      createdAt: input.createdAt,
    },
    record: {
      id: randomUUID(),
      employeeId: input.employeeId,
      workspaceId: input.workspaceId,
      metric: input.metric,
      value: input.value,
      createdAt: input.createdAt,
    },
  })
}

function resolveIncrements(
  job: Job,
  growth: EmployeeGrowthDefinition | undefined,
): Array<{ metric: string; value: number; jobId?: string }> {
  const increments: Array<{ metric: string; value: number; jobId?: string }> =
    []
  if (job.status === 'completed') {
    increments.push({ metric: 'completed_jobs', value: 1 })
    increments.push({ metric: `provider:${job.selectedProvider}`, value: 1 })
    increments.push({
      metric: 'active_days',
      value: 1,
      jobId: `day:${job.completedAt?.slice(0, 10) ?? job.createdAt.slice(0, 10)}`,
    })
  }
  if (job.status === 'failed') {
    increments.push({ metric: 'failed_jobs', value: 1 })
  }
  if (job.request === 'artifact-accepted') {
    return increments
  }
  for (const metric of growth?.metrics ?? []) {
    if (metric.incrementOn === 'job.completed' && job.status === 'completed') {
      increments.push({ metric: metric.id, value: 1 })
    }
    if (metric.incrementOn === 'job.failed' && job.status === 'failed') {
      increments.push({ metric: metric.id, value: 1 })
    }
  }
  return increments
}

function summarizeMetrics(
  records: readonly GrowthRecord[],
  growth: EmployeeGrowthDefinition | undefined,
): Array<{ id: string; label: string; value: number }> {
  const totals = new Map<string, number>()
  for (const record of records) {
    totals.set(record.metric, (totals.get(record.metric) ?? 0) + record.value)
  }
  const labels = new Map<string, string>([
    ['completed_jobs', '完了した仕事'],
    ['failed_jobs', '失敗した仕事'],
    ['accepted_artifacts', '採用した成果'],
    ['active_days', '活動日数'],
  ])
  for (const metric of growth?.metrics ?? []) {
    labels.set(metric.id, metric.label)
  }
  return [...totals.entries()]
    .filter(([id]) => !id.startsWith('provider:'))
    .map(([id, value]) => ({
      id,
      label: labels.get(id) ?? id,
      value,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function sumPrimary(metrics: readonly { id: string; value: number }[]): number {
  return (
    metrics.find((metric) => metric.id === 'completed_jobs')?.value ??
    metrics[0]?.value ??
    0
  )
}

function resolveLevel(
  value: number,
  growth: EmployeeGrowthDefinition | undefined,
): number {
  const levels = [...(growth?.levels ?? [{ level: 1, threshold: 0 }])].sort(
    (left, right) => left.level - right.level,
  )
  let current = levels[0]?.level ?? 1
  for (const level of levels) {
    if (value >= level.threshold) {
      current = level.level
    }
  }
  return current
}

function refreshWorldUnlocks(store: AppStore, workspaceId: string): void {
  const workspace = store.getWorkspace(workspaceId)
  if (!workspace) {
    return
  }
  const world = builtInWorlds.find((item) => item.id === workspace.worldPackId)
  if (!world) {
    return
  }
  const completed = sumMetric(store, workspaceId, 'completed_jobs')
  const accepted = sumMetric(store, workspaceId, 'accepted_artifacts')
  const now = new Date().toISOString()
  for (const unlock of world.unlocks) {
    if (
      !unlockSatisfied(
        store,
        workspaceId,
        unlock.condition,
        completed,
        accepted,
      )
    ) {
      continue
    }
    store.insertWorldFeatureUnlock({
      id: randomUUID(),
      workspaceId,
      worldPackId: world.id,
      unlockId: unlock.id,
      unlockedAt: now,
    })
  }
}

function unlockSatisfied(
  store: AppStore,
  workspaceId: string,
  condition: (typeof builtInWorlds)[number]['unlocks'][number]['condition'],
  completed: number,
  accepted: number,
): boolean {
  if ('completedJobs' in condition) {
    return completed >= condition.completedJobs
  }
  if ('totalAcceptedArtifacts' in condition) {
    return accepted >= condition.totalAcceptedArtifacts
  }
  const value = store
    .listGrowthRecords({
      employeeId: condition.employeeMetric.employeeId,
      workspaceId,
    })
    .filter((record) => record.metric === condition.employeeMetric.metric)
    .reduce((sum, record) => sum + record.value, 0)
  return value >= condition.employeeMetric.minimum
}

function sumMetric(
  store: AppStore,
  workspaceId: string,
  metric: string,
): number {
  return store
    .listGrowthRecords()
    .filter(
      (record) =>
        record.workspaceId === workspaceId && record.metric === metric,
    )
    .reduce((sum, record) => sum + record.value, 0)
}

function safePack(employees: EmployeeRegistry, employeeId: string) {
  try {
    return employees.getPack(employeeId)
  } catch {
    return undefined
  }
}
