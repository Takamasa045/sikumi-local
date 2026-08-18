import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import {
  CRASH_RECOVERY_REASON,
  createJobManager,
  orphanStaleExecutions,
} from './job-manager.js'

const tempDirectories: string[] = []
const managers: Array<ReturnType<typeof createJobManager>> = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('crash recovery hardening', () => {
  it('fails leftover live work once, denies pending approvals, and stays idempotent', () => {
    const { store, workspaceId } = openStore()
    const employee = store.ensureDefaultEmployee()
    store.insertJob({
      id: 'stale-job',
      workspaceId,
      employeeId: employee.id,
      request: '古い仕事',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'waiting_for_user',
      providerSessionId: 'thread-old',
      createdAt: 't0',
      startedAt: 't0',
      completedAt: null,
    })
    store.insertRun({
      id: 'stale-run',
      jobId: 'stale-job',
      providerId: 'fake',
      status: 'running',
      createdAt: 't0',
      startedAt: 't0',
      completedAt: null,
    })
    store.insertProviderSession({
      id: 'stale-session',
      providerId: 'fake',
      providerSessionId: 'thread-old',
      workspaceId,
      employeeId: employee.id,
      jobId: 'stale-job',
      cwd: '/tmp',
      status: 'active',
      createdAt: 't0',
      updatedAt: 't0',
    })
    store.insertApproval({
      id: 'stale-approval',
      jobId: 'stale-job',
      runId: 'stale-run',
      risk: 'medium',
      summary: '外部サイトへアクセスします',
      status: 'pending',
      createdAt: 't0',
      resolvedAt: null,
    })
    store.insertJob({
      id: 'done-job',
      workspaceId,
      employeeId: employee.id,
      request: '終わった仕事',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'completed',
      providerSessionId: null,
      createdAt: 't0',
      startedAt: 't0',
      completedAt: 't-done',
    })
    store.insertRun({
      id: 'done-run',
      jobId: 'done-job',
      providerId: 'fake',
      status: 'completed',
      createdAt: 't0',
      startedAt: 't0',
      completedAt: 't-done',
    })

    orphanStaleExecutions(store)
    const firstJob = store.getJob('stale-job')
    const firstEvents = store
      .listEvents('stale-job')
      .filter(
        (event) =>
          event.type === 'run.failed' &&
          event.payload.reason === CRASH_RECOVERY_REASON,
      )

    expect(firstJob?.status).toBe('failed')
    expect(firstJob?.completedAt).toBeTruthy()
    expect(store.getRun('stale-run')?.status).toBe('orphaned')
    expect(store.listProviderSessions('stale-job')[0]?.status).toBe('orphaned')
    expect(store.getApproval('stale-approval')).toMatchObject({
      status: 'denied',
    })
    expect(firstEvents).toHaveLength(1)
    expect(store.getJob('done-job')).toMatchObject({
      status: 'completed',
      completedAt: 't-done',
    })
    expect(store.getRun('done-run')?.status).toBe('completed')

    const completedAt = firstJob?.completedAt
    const resolvedAt = store.getApproval('stale-approval')?.resolvedAt
    orphanStaleExecutions(store)
    orphanStaleExecutions(store)

    expect(store.getJob('stale-job')?.completedAt).toBe(completedAt)
    expect(store.getApproval('stale-approval')?.resolvedAt).toBe(resolvedAt)
    expect(
      store
        .listEvents('stale-job')
        .filter(
          (event) =>
            event.type === 'run.failed' &&
            event.payload.reason === CRASH_RECOVERY_REASON,
        ),
    ).toHaveLength(1)
    expect(store.getJob('done-job')?.completedAt).toBe('t-done')
  })

  it('is idempotent when a second manager opens the same store after recovery', () => {
    const { store, workspaceId } = openStore()
    const employee = store.ensureDefaultEmployee()
    store.insertJob({
      id: 'queued-job',
      workspaceId,
      employeeId: employee.id,
      request: '待ち行列',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'queued',
      providerSessionId: null,
      createdAt: 't0',
      startedAt: null,
      completedAt: null,
    })

    const first = openManager(store)
    const recovered = first.store.getJob('queued-job')
    expect(recovered?.status).toBe('failed')
    const eventCount = first.store
      .listEvents('queued-job')
      .filter((event) => event.payload.reason === CRASH_RECOVERY_REASON).length

    const second = openManager(store)
    expect(second.store.getJob('queued-job')?.completedAt).toBe(
      recovered?.completedAt,
    )
    expect(
      second.store
        .listEvents('queued-job')
        .filter((event) => event.payload.reason === CRASH_RECOVERY_REASON),
    ).toHaveLength(eventCount)
  })
})

function openStore() {
  const dataDirectory = track(createTemporaryDirectory())
  const repositoryPath = track(createTemporaryGitRepository())
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  const store = createStore(opened.db)
  const workspace = store.createWorkspace({
    absolutePath: repositoryPath,
    displayName: 'workshop',
    currentBranch: 'main',
    remoteName: null,
    remoteUrl: null,
    readable: true,
  })
  return { store, workspaceId: workspace.id }
}

function openManager(store: ReturnType<typeof createStore>) {
  const manager = createJobManager(store, { fakeHarnessEnabled: true })
  managers.push(manager)
  return { manager, store }
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
