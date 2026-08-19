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
        summary: 'この工房の資料を読んでいます TOKEN=sk-live-secret-value',
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
      summary: 'コマンド実行の確認が必要です: TOKEN=sk-live-secret-value',
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
      sourceKind: 'builtin',
      sourceDisplay: 'builtin',
      commitHash: null,
      builtin: true,
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
      summary: 'この工房の資料を読んでいます TOKEN=[redacted]',
      details: { items: [{ note: 'ok' }] },
    })
    expect(store.getApproval('apr_1')?.summary).toBe(
      'コマンド実行の確認が必要です: TOKEN=[redacted]',
    )
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
    expect(store.listAllRuns()).toHaveLength(1)
    expect(store.listProviderSessions(job.id)).toHaveLength(1)
    expect(
      store.updateWorkspace(workspace.id, { defaultProviderId: 'codex' })
        .defaultProviderId,
    ).toBe('codex')
    expect(
      store.updateEmployee(employee.id, { defaultProviderId: 'claude-code' })
        .defaultProviderId,
    ).toBe('claude-code')
    expect(store.updateRun('run_1', { status: 'running' }).status).toBe(
      'running',
    )
    expect(() => store.updateJob('missing', { status: 'failed' })).toThrow()
    expect(() => store.updateRun('missing', { status: 'failed' })).toThrow()
    expect(() =>
      store.updateApproval('missing', { status: 'denied' }),
    ).toThrow()
    expect(store.listPacks()[0]?.packId).toBe('saguru')
    expect(store.getPack('pack_1')?.builtin).toBe(true)
    expect(store.findPack('employee', 'saguru')?.id).toBe('pack_1')
    expect(
      store.updatePack('pack_1', { sourceDisplay: 'builtin-core' })
        .sourceDisplay,
    ).toBe('builtin-core')
    expect(() => store.deletePack('pack_1')).toThrow(/組み込み/)
    const extraPack = store.insertPack({
      id: 'pack_2',
      kind: 'world',
      packId: 'night',
      version: '1.0.0',
      sourcePath: null,
      sourceKind: 'folder',
      sourceDisplay: 'night',
      commitHash: null,
      builtin: false,
      installedAt: 't',
    })
    store.deletePack(extraPack.id)
    expect(store.getPack(extraPack.id)).toBeUndefined()
    expect(
      store.tryInsertGrowthApplication({
        id: 'ga_1',
        jobId: 'job_1',
        employeeId: employee.id,
        scopeKey: 'global',
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      }),
    ).toBe(true)
    expect(
      store.tryInsertGrowthApplication({
        id: 'ga_2',
        jobId: 'job_1',
        employeeId: employee.id,
        scopeKey: 'global',
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      }),
    ).toBe(false)
    expect(store.listGrowthApplications({ jobId: 'job_1' })).toHaveLength(1)

    const firstOnce = store.recordGrowthOnce({
      application: {
        id: 'ga_atomic_1',
        jobId: 'job_atomic',
        employeeId: employee.id,
        scopeKey: 'global',
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      },
      record: {
        id: 'gr_atomic_1',
        employeeId: employee.id,
        workspaceId: null,
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      },
    })
    const racedOnce = store.recordGrowthOnce({
      application: {
        id: 'ga_atomic_2',
        jobId: 'job_atomic',
        employeeId: employee.id,
        scopeKey: 'global',
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      },
      record: {
        id: 'gr_atomic_2',
        employeeId: employee.id,
        workspaceId: null,
        metric: 'completed_jobs',
        value: 1,
        createdAt: 't',
      },
    })
    expect(firstOnce.applied).toBe(true)
    expect(racedOnce.applied).toBe(false)
    expect(store.listGrowthApplications({ jobId: 'job_atomic' })).toHaveLength(
      1,
    )
    expect(
      store
        .listGrowthRecords({ employeeId: employee.id, workspaceId: null })
        .filter(
          (item) => item.id === 'gr_atomic_1' || item.id === 'gr_atomic_2',
        ),
    ).toHaveLength(1)

    expect(() =>
      store.recordGrowthOnce({
        application: {
          id: 'ga_atomic_fail',
          jobId: 'job_atomic_fail',
          employeeId: employee.id,
          scopeKey: 'global',
          metric: 'failed_jobs',
          value: 1,
          createdAt: 't',
        },
        record: {
          id: 'gr_1',
          employeeId: employee.id,
          workspaceId: workspace.id,
          metric: 'failed_jobs',
          value: 1,
          createdAt: 't',
        },
      }),
    ).toThrow()
    expect(
      store.listGrowthApplications({ jobId: 'job_atomic_fail' }),
    ).toHaveLength(0)
    expect(
      store.listGrowthRecords({
        employeeId: employee.id,
        workspaceId: workspace.id,
      }).length,
    ).toBeGreaterThan(0)
    const worktree = store.insertJobWorktree({
      id: 'wt_1',
      jobId: job.id,
      repositoryId: workspace.repository.id,
      worktreeRelPath: 'worktrees/repo/job',
      branchName: 'shikumi/saguru/aaaaaaaa',
      baseCommit: 'abc',
      includeDirtyPatch: false,
      status: 'active',
      createdAt: 't',
      updatedAt: 't',
    })
    expect(store.getJobWorktreeByJobId(job.id)?.id).toBe(worktree.id)
    expect(store.listActiveWriteWorktrees()).toHaveLength(1)
    expect(
      store.updateJobWorktree(worktree.id, {
        status: 'completed',
        updatedAt: 't2',
      }).status,
    ).toBe('completed')
    store.insertPackPreview({
      id: 'prev_1',
      kind: 'employee',
      packId: 'miru',
      version: '1.0.0',
      sourceKind: 'folder',
      sourceDisplay: 'miru',
      validation: { ok: true, errors: [] },
      fileSummary: { files: 1, totalBytes: 1, names: ['employee.yaml'] },
      gitCommit: null,
      gitChanges: null,
      stagingRelPath: 'packs/staging/prev_1',
      createdAt: 't',
      expiresAt: 't2',
    })
    expect(store.getPackPreview('prev_1')?.packId).toBe('miru')
    store.deletePackPreview('prev_1')
    expect(store.getPackPreview('prev_1')).toBeUndefined()
    store.insertWorldFeatureUnlock({
      id: 'wfu_1',
      workspaceId: workspace.id,
      worldPackId: 'dog-office',
      unlockId: 'bookshelf-small',
      unlockedAt: 't',
    })
    expect(store.listWorldFeatureUnlocks(workspace.id)[0]?.unlockId).toBe(
      'bookshelf-small',
    )
    expect(store.listWorldUnlocks(workspace.id)).toHaveLength(1)
    expect(store.findRepositoryByAbsolutePath('/tmp/example-repo')?.id).toBe(
      workspace.repository.id,
    )

    const raw = readFileSync(opened.filePath)
    expect(raw.includes('secret-token')).toBe(false)
    expect(raw.includes('nested-reasoning')).toBe(false)
    expect(raw.includes('nested-secret')).toBe(false)
    expect(raw.includes('sk-live-secret-value')).toBe(false)
  })

  it('unregisters a workspace without touching the absolute path', () => {
    const opened = openTempDatabase()
    const store = createStore(opened.db)
    const workspace = store.createWorkspace({
      absolutePath: '/tmp/keep-this-folder',
      displayName: 'keep-this-folder',
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: null,
      readable: true,
    })

    store.deleteWorkspace(workspace.id)

    expect(store.listWorkspaces()).toEqual([])
    expect(store.getWorkspace(workspace.id)).toBeUndefined()
    expect(
      store.findRepositoryByAbsolutePath('/tmp/keep-this-folder'),
    ).toBeUndefined()
    expect(() => store.deleteWorkspace(workspace.id)).toThrow(
      /場所が見つかりません/,
    )
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
