import { readFileSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database.js'
import { createStore } from './store.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'

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

describe('AppStore persistence boundary', () => {
  it('round-trips every Phase 2 domain record', () => {
    const opened = openTempDatabase()
    const store = createStore(opened.db)
    const workspace = store.createWorkspace({
      absolutePath: '/tmp/example-repo',
      displayName: 'example-repo',
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/repo.git',
      readable: true,
    })

    const employee = store.insertEmployee({
      id: 'emp_1',
      packId: 'saguru',
      name: 'サグル',
      role: '調査担当',
      defaultProviderId: 'grok-build',
      createdAt: 't',
      updatedAt: 't',
    })
    store.insertEmployeeInstance({
      id: 'inst_1',
      workspaceId: workspace.id,
      employeeId: employee.id,
      characterPackId: 'saguru-default',
      createdAt: 't',
    })
    store.insertProviderSetting({
      id: 'ps_1',
      workspaceId: workspace.id,
      providerId: 'codex',
      selectedModel: 'default',
      createdAt: 't',
      updatedAt: 't',
    })
    const job = store.insertJob({
      id: 'job_1',
      workspaceId: workspace.id,
      employeeId: employee.id,
      request: '構成を調べて',
      jobType: 'research',
      selectedProvider: 'codex',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'queued',
      providerSessionId: null,
      createdAt: 't',
      startedAt: null,
      completedAt: null,
    })
    store.insertRun({
      id: 'run_1',
      jobId: job.id,
      providerId: 'codex',
      status: 'queued',
      createdAt: 't',
      startedAt: null,
      completedAt: null,
    })
    store.insertProviderSession({
      id: 'sess_1',
      providerId: 'codex',
      providerSessionId: 'thread-1',
      workspaceId: workspace.id,
      employeeId: employee.id,
      jobId: job.id,
      cwd: workspace.repository.absolutePath,
      status: 'idle',
      createdAt: 't',
      updatedAt: 't',
    })
    store.insertEvent({
      id: 'evt_1',
      jobId: job.id,
      runId: 'run_1',
      type: 'run.state_changed',
      payload: {
        summary: 'この工房の資料を読んでいます',
        reasoning: 'must not persist',
        token: 'secret-token',
        details: {
          thinking: 'nested-reasoning',
          items: [{ note: 'ok', authorization: 'Bearer nested-secret' }],
        },
      },
      occurredAt: 't',
    })
    store.insertApproval({
      id: 'apr_1',
      jobId: job.id,
      runId: 'run_1',
      risk: 'high',
      summary: '依存関係を追加します',
      status: 'pending',
      createdAt: 't',
      resolvedAt: null,
    })
    store.insertQuestion({
      id: 'q_1',
      jobId: job.id,
      prompt: '対象範囲は？',
      status: 'pending',
      answer: null,
      createdAt: 't',
      answeredAt: null,
    })
    store.insertArtifact({
      id: 'art_1',
      jobId: job.id,
      type: 'report',
      title: '調査メモ',
      storagePath: null,
      createdAt: 't',
    })
    store.insertGrowthRecord({
      id: 'gr_1',
      employeeId: employee.id,
      workspaceId: workspace.id,
      metric: 'completed_jobs',
      value: 1,
      createdAt: 't',
    })
    store.insertWorldUnlock({
      id: 'wu_1',
      workspaceId: workspace.id,
      worldPackId: 'dog-office',
      unlockedAt: 't',
    })
    store.insertPack({
      id: 'pack_1',
      kind: 'employee',
      packId: 'saguru',
      version: '1.0.0',
      sourcePath: null,
      installedAt: 't',
    })

    expect(store.listProviders().map((provider) => provider.id)).toEqual([
      'codex',
      'grok-build',
      'claude-code',
    ])
    expect(
      store.listProviders().every((provider) => !provider.executionConnected),
    ).toBe(true)
    expect(store.getJob(job.id)?.request).toBe('構成を調べて')
    expect(store.listRuns(job.id)).toHaveLength(1)
    expect(store.listEvents(job.id)[0]?.payload).toEqual({
      summary: 'この工房の資料を読んでいます',
      details: { items: [{ note: 'ok' }] },
    })
    expect(() =>
      store.insertEvent({
        id: 'evt_cycle',
        jobId: job.id,
        runId: 'run_1',
        type: 'run.failed',
        payload: createCyclicPayload(),
        occurredAt: 't',
      }),
    ).toThrow()
    expect(store.listEmployees()[0]?.name).toBe('サグル')
    expect(store.listJobs(workspace.id)).toHaveLength(1)
    expect(store.updateJob(job.id, { status: 'running' }).status).toBe(
      'running',
    )
    expect(store.listApprovals({ status: 'pending' })).toHaveLength(1)
    expect(store.listArtifacts(job.id)[0]?.title).toBe('調査メモ')
    expect(store.ensureDefaultEmployee().id).toBe('saguru')
    expect(store.ensureDefaultEmployee().id).toBe('saguru')
    expect(store.getApproval('apr_1')?.status).toBe('pending')
    expect(store.updateApproval('apr_1', { status: 'denied' }).status).toBe(
      'denied',
    )
    expect(store.getArtifact('art_1')?.title).toBe('調査メモ')
    expect(store.getRun('run_1')?.status).toBe('queued')
    expect(store.updateRun('run_1', { status: 'running' }).status).toBe(
      'running',
    )
    expect(() => store.updateJob('missing', { status: 'failed' })).toThrow()
    expect(() => store.updateRun('missing', { status: 'failed' })).toThrow()
    expect(() =>
      store.updateApproval('missing', { status: 'denied' }),
    ).toThrow()
    expect(store.listPacks()[0]?.packId).toBe('saguru')
    expect(store.findRepositoryByAbsolutePath('/tmp/example-repo')?.id).toBe(
      workspace.repository.id,
    )

    const raw = readFileSync(opened.filePath)
    expect(raw.includes('secret-token')).toBe(false)
    expect(raw.includes('nested-reasoning')).toBe(false)
    expect(raw.includes('nested-secret')).toBe(false)
  })

  it('never writes secret remote credentials into sqlite', () => {
    const opened = openTempDatabase()
    const store = createStore(opened.db)

    store.createWorkspace({
      absolutePath: '/tmp/secret-repo',
      displayName: 'secret-repo',
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/secret-repo.git',
      readable: true,
    })

    const raw = readFileSync(opened.filePath)
    expect(raw.includes('ghs_super_secret')).toBe(false)
    expect(raw.includes('x-access-token')).toBe(false)
  })
})

function openTempDatabase() {
  const directory = createTemporaryDirectory()
  tempDirectories.push(directory)
  const opened = openDatabase(directory)
  databases.push(opened)
  return opened
}

function createCyclicPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = { summary: 'cycle' }
  payload.self = payload
  return payload
}
