import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import type { AgentProviderAdapter } from '@sikumi-local/provider-sdk'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { installFixtureEmployee } from '../test/fixture-employee.js'
import { createJobManager } from '../jobs/job-manager.js'
import {
  applyWorktreeToCurrentTree,
  collectWorktreeDiff,
  discardJobWorktree,
  inspectRepositoryGitState,
  isSecretFileName,
  keepJobWorktreeBranch,
  persistWorktreeArtifacts,
} from './manager.js'
import { worktreeBranchName, worktreeRelPath } from './paths.js'

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

describe('worktree path and branch contracts', () => {
  it('builds a contained branch name and rejects traversal', () => {
    expect(
      worktreeBranchName('tsukuru', 'a8f3d2aa-1111-4111-8111-aaaaaaaaaaaa'),
    ).toBe('shikumi/tsukuru/a8f3d2aa')
    expect(() => worktreeBranchName('../etc', 'job-1')).toThrow(AppError)
    expect(() => worktreeRelPath('../repo', 'job-1')).toThrow(AppError)
  })
})

describe('real git worktree isolation', () => {
  it('runs an edit-worktree job off the registered tree, then apply and discard', async () => {
    const { manager, store, workspace, dataDirectory, repoPath } = openWorld()
    const originalReadme = readFileSync(join(repoPath, 'README.md'), 'utf8')
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: 'ファイルを足して',
      employeeId: 'kakikae',
      dirtyWorktreePolicy: 'from-head',
    })
    await waitForJob(manager, job.id, 'completed')

    expect(readFileSync(join(repoPath, 'README.md'), 'utf8')).toBe(
      originalReadme,
    )
    expect(existsSync(join(repoPath, 'from-worktree.txt'))).toBe(false)
    const worktree = store.getJobWorktreeByJobId(job.id)
    expect(worktree?.branchName).toMatch(/^shikumi\/kakikae\/[a-z0-9]{8}$/)
    expect(worktree?.baseCommit.length).toBeGreaterThan(8)
    expect(
      existsSync(join(dataDirectory, worktree?.worktreeRelPath ?? '')),
    ).toBe(true)
    expect(
      readFileSync(
        join(
          dataDirectory,
          worktree?.worktreeRelPath ?? '',
          'from-worktree.txt',
        ),
        'utf8',
      ),
    ).toContain('isolated')

    const artifacts = store.listArtifacts(job.id)
    expect(artifacts.some((item) => item.type === 'patch')).toBe(true)
    expect(artifacts.some((item) => item.type === 'code_diff')).toBe(true)
    const described = manager.describeWorktree(job.id)
    expect(described.diff.files).toContain('from-worktree.txt')
    expect(JSON.stringify(described)).not.toContain(dataDirectory)

    const patch = artifacts.find((item) => item.type === 'patch')
    expect(patch).toBeTruthy()
    expect(manager.exportArtifact(patch!.id, true).exportRelPath).toContain(
      'exports/',
    )
    manager.applyArtifact(patch!.id, true)
    expect(readFileSync(join(repoPath, 'from-worktree.txt'), 'utf8')).toContain(
      'isolated',
    )

    const second = await manager.createJob({
      workspaceId: workspace.id,
      request: 'もう一つ',
      employeeId: 'kakikae',
      dirtyWorktreePolicy: 'from-head',
    })
    await waitForJob(manager, second.id, 'completed')
    manager.discardWorktree(second.id, true)
    expect(
      existsSync(
        join(
          dataDirectory,
          store.getJobWorktreeByJobId(second.id)?.worktreeRelPath ?? 'missing',
        ),
      ),
    ).toBe(false)
    const branches = execFileSync('git', ['-C', repoPath, 'branch'], {
      encoding: 'utf8',
    })
    expect(branches).not.toContain(
      store.getJobWorktreeByJobId(second.id)?.branchName ?? 'missing-branch',
    )
  })

  it('copies untracked dirty files into the worktree and rejects applying a report', async () => {
    const { manager, store, repoPath, workspace, dataDirectory } = openWorld()
    writeFileSync(join(repoPath, 'scratch-note.txt'), 'untracked dirty\n')
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '直して',
      employeeId: 'kakikae',
      dirtyWorktreePolicy: 'include-dirty-patch',
    })
    await waitForJob(manager, job.id, 'completed')
    const record = store.getJobWorktreeByJobId(job.id)
    expect(record).toBeTruthy()
    expect(
      readFileSync(
        join(dataDirectory, record!.worktreeRelPath, 'scratch-note.txt'),
        'utf8',
      ),
    ).toBe('untracked dirty\n')
    expect(existsSync(join(repoPath, 'from-worktree.txt'))).toBe(false)

    const report = store.insertArtifact({
      id: 'art-report-apply',
      jobId: job.id,
      type: 'report',
      title: 'メモ',
      storagePath: join(dataDirectory, 'note.txt'),
      createdAt: 't',
    })
    writeFileSync(join(dataDirectory, 'note.txt'), 'note\n')
    expect(() => manager.applyArtifact(report.id, true)).toThrow(/適用できません/)
  })

  it('refuses apply and discard while the write job is still running', async () => {
    const { manager, store, workspace } = openWorld({
      adapter: hangingAdapter(),
    })
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '実行中',
      employeeId: 'kakikae',
    })
    expect(manager.getJob(job.id).status).toBe('running')
    store.insertArtifact({
      id: 'art-running-patch',
      jobId: job.id,
      type: 'patch',
      title: '変更パッチ',
      storagePath: null,
      createdAt: 't',
    })
    expect(() => manager.applyArtifact('art-running-patch', true)).toThrow(
      /実行中/,
    )
    expect(() => manager.discardWorktree(job.id, true)).toThrow(/実行中/)
    expect(() => manager.keepWorktree(job.id, true)).toThrow(/実行中/)
    await manager.cancelJob(job.id)
  })

  it('fails the job instead of completing when the worktree diff is unsafe', async () => {
    const { manager, store, workspace, dataDirectory } = openWorld({
      adapter: secretWritingAdapter(),
    })
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '秘密を書く',
      employeeId: 'kakikae',
    })
    await waitForJob(manager, job.id, 'failed')
    expect(store.getJob(job.id)?.status).toBe('failed')
    expect(
      store.listArtifacts(job.id).some((item) => item.type === 'patch'),
    ).toBe(false)
    const record = store.getJobWorktreeByJobId(job.id)
    expect(record?.status).toBe('active')
    expect(
      existsSync(join(dataDirectory, record?.worktreeRelPath ?? '', '.env')),
    ).toBe(true)
  })

  it('does not auto-import a dirty repo and supports the explicit contract', async () => {
    const { manager, store, repoPath, workspace } = openWorld()
    writeFileSync(join(repoPath, 'README.md'), '# dirty\n')
    expect(inspectRepositoryGitState(repoPath).dirty).toBe(true)

    await expect(
      manager.createJob({
        workspaceId: workspace.id,
        request: '直して',
        employeeId: 'kakikae',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKTREE_DIRTY_REPO',
    })

    await expect(
      manager.createJob({
        workspaceId: workspace.id,
        request: '直して',
        employeeId: 'kakikae',
        dirtyWorktreePolicy: 'cancel',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKTREE_CANCELLED',
    })

    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '直して',
      employeeId: 'kakikae',
      dirtyWorktreePolicy: 'include-dirty-patch',
    })
    await waitForJob(manager, job.id, 'completed')
    expect(readFileSync(join(repoPath, 'README.md'), 'utf8')).toBe('# dirty\n')
    manager.keepWorktree(job.id, true)
    expect(store.getJobWorktreeByJobId(job.id)?.status).toBe('kept')
  })

  it('fails closed when applying onto a dirty current tree', async () => {
    const { manager, store, repoPath, workspace, dataDirectory } = openWorld()
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '直して',
      employeeId: 'kakikae',
    })
    await waitForJob(manager, job.id, 'completed')
    writeFileSync(join(repoPath, 'README.md'), '# meanwhile\n')
    expect(() =>
      applyWorktreeToCurrentTree({
        store,
        dataDirectory,
        jobId: job.id,
        repositoryPath: repoPath,
        confirm: true,
      }),
    ).toThrow(/未commitの変更/)
    expect(existsSync(join(repoPath, 'from-worktree.txt'))).toBe(false)
    discardJobWorktree({
      store,
      dataDirectory,
      jobId: job.id,
      repositoryPath: repoPath,
      confirm: true,
    })
    expect(
      existsSync(
        join(
          dataDirectory,
          store.getJobWorktreeByJobId(job.id)?.worktreeRelPath ?? 'missing',
        ),
      ),
    ).toBe(false)
  })

  it('rejects reused applied or discarded worktrees', async () => {
    const { manager, store, workspace, dataDirectory, repoPath } = openWorld()
    const first = await manager.createJob({
      workspaceId: workspace.id,
      request: '1',
      employeeId: 'kakikae',
    })
    await waitForJob(manager, first.id, 'completed')
    const patch = store
      .listArtifacts(first.id)
      .find((item) => item.type === 'patch')
    expect(patch).toBeTruthy()
    manager.applyArtifact(patch!.id, true)
    expect(() => manager.applyArtifact(patch!.id, true)).toThrow(/すでに適用/)
    const second = await manager.createJob({
      workspaceId: workspace.id,
      request: '3',
      employeeId: 'kakikae',
      dirtyWorktreePolicy: 'from-head',
    })
    await waitForJob(manager, second.id, 'completed')
    manager.discardWorktree(second.id, true)
    expect(() =>
      applyWorktreeToCurrentTree({
        store,
        dataDirectory,
        jobId: second.id,
        repositoryPath: repoPath,
        confirm: true,
      }),
    ).toThrow(/破棄/)
  })

  it('keeps the worktree checkout, branch, and uncommitted files on disk', async () => {
    const { manager, store, workspace, dataDirectory, repoPath } = openWorld()
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '残して',
      employeeId: 'kakikae',
    })
    await waitForJob(manager, job.id, 'completed')
    const record = store.getJobWorktreeByJobId(job.id)
    expect(record).toBeTruthy()
    const worktreeAbs = join(dataDirectory, record!.worktreeRelPath)
    const leftover = join(worktreeAbs, 'keep-me.txt')
    writeFileSync(leftover, 'uncommitted keep\n')

    const kept = keepJobWorktreeBranch({
      store,
      dataDirectory,
      jobId: job.id,
      repositoryPath: repoPath,
      confirm: true,
    })
    expect(kept.status).toBe('kept')
    expect(existsSync(leftover)).toBe(true)
    expect(readFileSync(leftover, 'utf8')).toBe('uncommitted keep\n')
    expect(existsSync(worktreeAbs)).toBe(true)
    const listed = execFileSync('git', ['-C', repoPath, 'worktree', 'list'], {
      encoding: 'utf8',
    })
    expect(listed).toContain(worktreeAbs)
    const branches = execFileSync('git', ['-C', repoPath, 'branch'], {
      encoding: 'utf8',
    })
    expect(branches).toContain(record!.branchName)
    expect(store.getJobWorktreeByJobId(job.id)?.status).toBe('kept')
  })

  it('refuses apply when the current HEAD has moved past baseCommit', async () => {
    const { manager, store, workspace, dataDirectory, repoPath } = openWorld()
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '適用',
      employeeId: 'kakikae',
    })
    await waitForJob(manager, job.id, 'completed')
    writeFileSync(join(repoPath, 'advanced.txt'), 'moved\n')
    execFileSync('git', ['-C', repoPath, 'add', 'advanced.txt'])
    execFileSync('git', ['-C', repoPath, 'commit', '-m', 'advance head'])

    expect(() =>
      applyWorktreeToCurrentTree({
        store,
        dataDirectory,
        jobId: job.id,
        repositoryPath: repoPath,
        confirm: true,
      }),
    ).toThrow(/base commit|一致しません/)
    expect(existsSync(join(repoPath, 'from-worktree.txt'))).toBe(false)
    expect(store.getJobWorktreeByJobId(job.id)?.status).not.toBe('applied')
  })

  it('does not mark discarded when git worktree removal fails', async () => {
    const { manager, store, workspace, dataDirectory, repoPath } = openWorld()
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '破棄',
      employeeId: 'kakikae',
    })
    await waitForJob(manager, job.id, 'completed')
    const record = store.getJobWorktreeByJobId(job.id)
    expect(record).toBeTruthy()
    const worktreeAbs = join(dataDirectory, record!.worktreeRelPath)
    execFileSync('git', ['-C', repoPath, 'worktree', 'lock', worktreeAbs])

    expect(() =>
      discardJobWorktree({
        store,
        dataDirectory,
        jobId: job.id,
        repositoryPath: repoPath,
        confirm: true,
      }),
    ).toThrow(/安全に削除|DISCARD/)
    expect(store.getJobWorktreeByJobId(job.id)?.status).not.toBe('discarded')
    expect(existsSync(worktreeAbs)).toBe(true)
    const branches = execFileSync('git', ['-C', repoPath, 'branch'], {
      encoding: 'utf8',
    })
    expect(branches).toContain(record!.branchName)
  })

  it('rejects secret filenames and secret-like values in diffs and dirty patches', async () => {
    expect(isSecretFileName('.env')).toBe(true)
    expect(isSecretFileName('src/.npmrc')).toBe(true)
    expect(isSecretFileName('.netrc')).toBe(true)
    expect(isSecretFileName('id_rsa')).toBe(true)
    expect(isSecretFileName('src/app.ts')).toBe(false)

    const { manager, store, workspace, dataDirectory, repoPath } = openWorld()
    const job = await manager.createJob({
      workspaceId: workspace.id,
      request: '秘密',
      employeeId: 'kakikae',
    })
    await waitForJob(manager, job.id, 'completed')
    const record = store.getJobWorktreeByJobId(job.id)
    expect(record).toBeTruthy()
    const worktreeAbs = join(dataDirectory, record!.worktreeRelPath)
    writeFileSync(join(worktreeAbs, '.env'), 'SECRET=super-secret\n')
    expect(() =>
      collectWorktreeDiff({
        repositoryPath: repoPath,
        worktreePath: worktreeAbs,
        baseCommit: record!.baseCommit,
      }),
    ).toThrow(/秘密/)
    expect(() =>
      persistWorktreeArtifacts({
        store,
        dataDirectory,
        jobId: job.id,
        repositoryPath: repoPath,
      }),
    ).toThrow(/秘密/)
    expect(
      store
        .listArtifacts(job.id)
        .some((item) =>
          item.storagePath
            ? readFileSync(item.storagePath, 'utf8').includes('super-secret')
            : false,
        ),
    ).toBe(false)

    rmSync(join(worktreeAbs, '.env'))
    writeFileSync(join(worktreeAbs, 'notes.txt'), 'TOKEN=sk-live-secret-value\n')
    expect(() =>
      collectWorktreeDiff({
        repositoryPath: repoPath,
        worktreePath: worktreeAbs,
        baseCommit: record!.baseCommit,
      }),
    ).toThrow(/秘密/)

    writeFileSync(join(repoPath, '.env.local'), 'API_KEY=hidden\n')
    await expect(
      manager.createJob({
        workspaceId: workspace.id,
        request: 'dirty secret',
        employeeId: 'kakikae',
        dirtyWorktreePolicy: 'include-dirty-patch',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKTREE_UNSAFE_DIFF',
    })

    writeFileSync(join(repoPath, 'README.md'), 'TOKEN=sk-live-secret-value\n')
    await expect(
      manager.createJob({
        workspaceId: workspace.id,
        request: 'dirty content',
        employeeId: 'kakikae',
        dirtyWorktreePolicy: 'include-dirty-patch',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      code: 'WORKTREE_UNSAFE_DIFF',
    })
  })

  it('covers apply/export/persist fail-closed branches without leaking state', async () => {
    const { manager, store, workspace, dataDirectory, repoPath } = openWorld({
      adapter: emptyAdapter(),
    })
    expect(isSecretFileName('.ssh/id_rsa')).toBe(true)
    expect(isSecretFileName('src/.aws/credentials')).toBe(true)
    persistWorktreeArtifacts({
      store,
      dataDirectory,
      jobId: 'missing-job',
      repositoryPath: repoPath,
    })

    const emptyJob = await manager.createJob({
      workspaceId: workspace.id,
      request: '空',
      employeeId: 'kakikae',
    })
    await waitForJob(manager, emptyJob.id, 'completed')
    const applied = applyWorktreeToCurrentTree({
      store,
      dataDirectory,
      jobId: emptyJob.id,
      repositoryPath: repoPath,
      confirm: true,
    })
    expect(applied.status).toBe('applied')

    const job = store.insertJob({
      id: 'job-export-guard',
      workspaceId: workspace.id,
      employeeId: 'saguru',
      request: 'export',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'completed',
      providerSessionId: null,
      createdAt: 't',
      startedAt: 't',
      completedAt: 't',
    })
    const reportPath = join(dataDirectory, 'note.txt')
    writeFileSync(reportPath, 'note\n')
    store.insertArtifact({
      id: 'art-report',
      jobId: job.id,
      type: 'report',
      title: 'メモ',
      storagePath: reportPath,
      createdAt: 't',
    })
    expect(() =>
      manager.exportArtifact('missing-artifact', true),
    ).toThrow(/成果/)
    expect(() => manager.exportArtifact('art-report', true)).toThrow(
      /書き出せません/,
    )
    expect(() =>
      applyWorktreeToCurrentTree({
        store,
        dataDirectory,
        jobId: 'missing-worktree',
        repositoryPath: repoPath,
        confirm: true,
      }),
    ).toThrow(/Worktreeが見つかりません/)

    const keptJob = await manager.createJob({
      workspaceId: workspace.id,
      request: 'keep missing',
      employeeId: 'kakikae',
      dirtyWorktreePolicy: 'from-head',
    })
    await waitForJob(manager, keptJob.id, 'completed')
    const keptRecord = store.getJobWorktreeByJobId(keptJob.id)
    expect(keptRecord).toBeTruthy()
    rmSync(join(dataDirectory, keptRecord!.worktreeRelPath), {
      recursive: true,
      force: true,
    })
    const described = manager.describeWorktree(keptJob.id)
    expect(described.diff.files).toEqual([])
    expect(
      keepJobWorktreeBranch({
        store,
        dataDirectory,
        jobId: keptJob.id,
        repositoryPath: repoPath,
        confirm: true,
      }).status,
    ).toBe('kept')
  })
})

function openWorld(options?: { adapter?: AgentProviderAdapter }) {
  const dataDirectory = track(createTemporaryDirectory())
  installFixtureEmployee(dataDirectory, 'kakikae')
  const repoPath = track(createTemporaryGitRepository())
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  const store = createStore(opened.db)
  const workspace = store.createWorkspace({
    absolutePath: repoPath,
    displayName: 'workshop',
    currentBranch: 'main',
    remoteName: null,
    remoteUrl: null,
    readable: true,
  })
  const manager = createJobManager(store, {
    fakeHarnessEnabled: true,
    dataDirectory,
    adapter: options?.adapter ?? writingAdapter(),
  })
  managers.push(manager)
  return { manager, store, workspace, dataDirectory, repoPath }
}

function hangingAdapter(): AgentProviderAdapter {
  let release: (() => void) | undefined
  return {
    ...writingAdapter(),
    async startRun(specification) {
      return {
        runId: specification.runId,
        providerId: 'fake',
        events: async function* () {
          yield {
            type: 'run.started' as const,
            runId: specification.runId,
            occurredAt: new Date().toISOString(),
            summary: '実行中',
          }
          await new Promise<void>((resolve) => {
            release = resolve
          })
        },
        cancel: async () => {
          release?.()
        },
      }
    },
    async cancelRun() {
      release?.()
    },
  }
}

function secretWritingAdapter(): AgentProviderAdapter {
  return {
    ...writingAdapter(),
    async startRun(specification) {
      writeFileSync(join(specification.cwd, '.env'), 'SECRET=super-secret\n')
      return {
        runId: specification.runId,
        providerId: 'fake',
        events: async function* () {
          yield {
            type: 'run.completed' as const,
            runId: specification.runId,
            occurredAt: new Date().toISOString(),
            summary: '秘密ファイルを書きました',
          }
        },
        cancel: async () => {},
      }
    },
  }
}

function emptyAdapter(): AgentProviderAdapter {
  return {
    ...writingAdapter(),
    async startRun(specification) {
      return {
        runId: specification.runId,
        providerId: 'fake',
        events: async function* () {
          yield {
            type: 'run.completed' as const,
            runId: specification.runId,
            occurredAt: new Date().toISOString(),
            summary: '変更なし',
          }
        },
        cancel: async () => {},
      }
    },
  }
}

function writingAdapter(): AgentProviderAdapter {
  return {
    id: 'fake',
    displayName: '開発用ハーネス',
    advertisedAsRealProvider: false,
    async probe() {
      throw new Error('unused')
    },
    async getAuthStatus() {
      throw new Error('unused')
    },
    async listModels() {
      return []
    },
    async getCapabilities() {
      throw new Error('unused')
    },
    async startRun(specification) {
      writeFileSync(join(specification.cwd, 'from-worktree.txt'), 'isolated\n')
      return {
        runId: specification.runId,
        providerId: 'fake',
        events: async function* () {
          yield {
            type: 'run.completed' as const,
            runId: specification.runId,
            occurredAt: new Date().toISOString(),
            summary: '変更を用意しました',
          }
        },
        cancel: async () => {},
      }
    },
    async resumeRun() {
      throw new Error('unused')
    },
    async respondToApproval() {
      throw new Error('unused')
    },
    async respondToQuestion() {
      throw new Error('unused')
    },
    async cancelRun() {},
    async dispose() {},
  }
}

async function waitForJob(
  manager: ReturnType<typeof createJobManager>,
  jobId: string,
  status: string,
) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (manager.getJob(jobId).status === status) {
      return manager.getJob(jobId)
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
  throw new Error(`Timed out waiting for ${jobId} ${status}`)
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
