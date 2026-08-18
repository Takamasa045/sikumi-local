import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmployeeRegistry } from '../employees/registry.js'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import {
  applyAcceptedArtifactGrowth,
  applyJobGrowth,
  exportPortableGrowth,
  listEmployeeGrowth,
  listGlobalGrowth,
  listWorkspaceGrowth,
} from './manager.js'

const tempDirectories: string[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(() => {
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('growth exactly-once and visual-only levels', () => {
  it('updates global and workspace growth once and never changes permission', () => {
    const { store, employees, workspaceId } = openGrowth()
    const job = store.insertJob({
      id: 'job-growth-1',
      workspaceId,
      employeeId: 'saguru',
      request: '調べて',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'completed',
      providerSessionId: null,
      createdAt: '2026-08-18T00:00:00.000Z',
      startedAt: 't',
      completedAt: '2026-08-18T00:00:00.000Z',
    })
    applyJobGrowth({ store, employees, job })
    applyJobGrowth({ store, employees, job })

    const global = listEmployeeGrowth(store, employees, 'saguru')
    const local = listEmployeeGrowth(store, employees, 'saguru', workspaceId)
    expect(
      global.metrics.find((item) => item.id === 'completed_jobs')?.value,
    ).toBe(1)
    expect(
      local.metrics.find((item) => item.id === 'research_completed')?.value,
    ).toBe(1)
    expect(global.level).toBeGreaterThanOrEqual(1)
    expect(global.permissionProfile).toBe('research')
    expect(employees.get('saguru').permissionProfile).toBe('research')
    expect(store.getEmployee('saguru')?.defaultProviderId).toBeNull()
    expect(local.unlocks).toContain('bookshelf-small')

    applyAcceptedArtifactGrowth({ store, job })
    applyAcceptedArtifactGrowth({ store, job })
    const afterAccept = listEmployeeGrowth(
      store,
      employees,
      'saguru',
      workspaceId,
    )
    expect(
      afterAccept.metrics.find((item) => item.id === 'accepted_artifacts')
        ?.value,
    ).toBe(1)
    expect(afterAccept.unlocks).toContain('monument')
    expect(afterAccept.permissionProfile).toBe('research')

    const exported = exportPortableGrowth(store, employees)
    const serialized = JSON.stringify(exported)
    expect(serialized).not.toContain('/Users/')
    expect(serialized).not.toContain('reasoning')
    expect(serialized).not.toContain('sk-')
    expect(exported.employees[0]?.employeeId).toBe('saguru')

    const failed = store.insertJob({
      id: 'job-growth-fail',
      workspaceId,
      employeeId: 'saguru',
      request: '失敗',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'failed',
      providerSessionId: null,
      createdAt: '2026-08-18T00:00:00.000Z',
      startedAt: 't',
      completedAt: '2026-08-18T00:00:00.000Z',
    })
    applyJobGrowth({ store, employees, job: failed })
    const afterFail = listEmployeeGrowth(store, employees, 'saguru')
    expect(
      afterFail.metrics.find((item) => item.id === 'failed_jobs')?.value,
    ).toBe(1)
    expect(
      listWorkspaceGrowth(store, employees, workspaceId).length,
    ).toBeGreaterThan(0)
    expect(listGlobalGrowth(store, employees)[0]?.employeeId).toBe('saguru')
  })

  it('applies growth at most once even when two callers race', () => {
    const { store, employees, workspaceId } = openGrowth()
    const job = store.insertJob({
      id: 'job-growth-race',
      workspaceId,
      employeeId: 'saguru',
      request: '調べて',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'completed',
      providerSessionId: null,
      createdAt: '2026-08-18T00:00:00.000Z',
      startedAt: 't',
      completedAt: '2026-08-18T00:00:00.000Z',
    })
    applyJobGrowth({ store, employees, job })
    applyJobGrowth({ store, employees, job })
    const first = store.recordGrowthOnce({
      application: {
        id: 'race-app-1',
        jobId: job.id,
        employeeId: 'saguru',
        scopeKey: 'global',
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      },
      record: {
        id: 'race-rec-1',
        employeeId: 'saguru',
        workspaceId: null,
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      },
    })
    const second = store.recordGrowthOnce({
      application: {
        id: 'race-app-2',
        jobId: job.id,
        employeeId: 'saguru',
        scopeKey: 'global',
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      },
      record: {
        id: 'race-rec-2',
        employeeId: 'saguru',
        workspaceId: null,
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      },
    })
    expect(first.applied).toBe(false)
    expect(second.applied).toBe(false)
    expect(
      store
        .listGrowthRecords({ employeeId: 'saguru', workspaceId: null })
        .filter((item) => item.metric === 'completed_jobs')
        .reduce((sum, item) => sum + item.value, 0),
    ).toBe(1)
  })
})

function openGrowth() {
  const dataDirectory = track(createTemporaryDirectory())
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  const store = createStore(opened.db)
  const employees = createEmployeeRegistry({ dataDirectory })
  employees.refresh()
  employees.syncToStore(store)
  const workspace = store.createWorkspace({
    absolutePath: track(createTemporaryDirectory()),
    displayName: 'workshop',
    currentBranch: 'main',
    remoteName: null,
    remoteUrl: null,
    readable: true,
  })
  return { store, employees, workspaceId: workspace.id }
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
