import { AppError } from '@sikumi-local/core'
import { describe, expect, it } from 'vitest'
import { registerWorkspace } from './register-workspace.js'
import type { AppStore } from '../storage/store.js'
import type { GitInspection } from './git-repository.js'
import type { Repository, Workspace } from '@sikumi-local/core'

describe('registerWorkspace', () => {
  it('persists a newly inspected repository', () => {
    const store = createMemoryStore()
    const inspection = sampleInspection('/Users/example/project')

    const workspace = registerWorkspace(
      store,
      '/Users/example/project',
      undefined,
      () => inspection,
    )

    expect(workspace.repository.absolutePath).toBe('/Users/example/project')
    expect(workspace.employeeName).toBe('プロジェクト番')
    expect(store.listWorkspaces()).toHaveLength(1)
  })

  it('任意の担当名を登録できる', () => {
    const store = createMemoryStore()
    const workspace = registerWorkspace(
      store,
      '/Users/example/blog-agent-kit',
      'イトパン',
      () => sampleInspection('/Users/example/blog-agent-kit'),
    )

    expect(workspace.employeeName).toBe('イトパン')
  })

  it('shikumi を含む場所はしくみローカル番にする', () => {
    const store = createMemoryStore()
    const workspace = registerWorkspace(
      store,
      '/Users/example/sikumi-local',
      undefined,
      () => sampleInspection('/Users/example/sikumi-local', 'sikumi-local'),
    )

    expect(workspace.employeeName).toBe('しくみローカル番')
  })

  it('rejects a duplicate real path', () => {
    const store = createMemoryStore()
    const inspection = sampleInspection('/Users/example/project')
    registerWorkspace(
      store,
      '/Users/example/project',
      undefined,
      () => inspection,
    )

    try {
      registerWorkspace(
        store,
        '/Users/example/project',
        undefined,
        () => inspection,
      )
      throw new Error('expected REPOSITORY_DUPLICATE')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('REPOSITORY_DUPLICATE')
    }
  })

  it('rejects path traversal before inspection', () => {
    const store = createMemoryStore()

    expect(() =>
      registerWorkspace(store, '/Users/example/../secret', undefined, () => {
        throw new Error('inspect should not run')
      }),
    ).toThrow(AppError)
  })
})

function sampleInspection(
  absolutePath: string,
  displayName = 'project',
): GitInspection {
  return {
    absolutePath,
    displayName,
    currentBranch: 'main',
    remoteName: 'origin',
    remoteUrl: 'https://github.com/example/project.git',
    readable: true,
  }
}

function createMemoryStore(): AppStore {
  const workspaces: Workspace[] = []
  const repositories: Repository[] = []

  return {
    listWorkspaces: () => workspaces,
    getWorkspace: (id) => workspaces.find((workspace) => workspace.id === id),
    findRepositoryByAbsolutePath: (absolutePath) =>
      repositories.find(
        (repository) => repository.absolutePath === absolutePath,
      ),
    updateWorkspace: (id, patch) => {
      throw new Error(
        `unexpected updateWorkspace ${id} ${JSON.stringify(patch)}`,
      )
    },
    importDetachedWorkspace: (input) => {
      throw new Error(`unexpected importDetachedWorkspace ${input.id}`)
    },
    createWorkspace: (inspection, employeeName) => {
      const workspace: Workspace = {
        id: `ws_${workspaces.length + 1}`,
        name: inspection.displayName,
        employeeName,
        defaultProviderId: null,
        worldPackId: 'dog-office',
        createdAt: 't',
        updatedAt: 't',
        repository: {
          id: `repo_${repositories.length + 1}`,
          absolutePath: inspection.absolutePath,
          displayName: inspection.displayName,
          currentBranch: inspection.currentBranch,
          remoteName: inspection.remoteName,
          remoteUrl: inspection.remoteUrl,
          readable: inspection.readable,
        },
      }
      workspaces.push(workspace)
      repositories.push(workspace.repository)
      return workspace
    },
    listProviders: () => [],
    insertEmployee: (employee) => employee,
    getEmployee: () => undefined,
    listEmployees: () => [],
    updateEmployee: (id, patch) => {
      throw new Error(
        `unexpected updateEmployee ${id} ${JSON.stringify(patch)}`,
      )
    },
    insertEmployeeInstance: (instance) => instance,
    insertProviderSetting: (setting) => setting,
    insertJob: (job) => job,
    getJob: () => undefined,
    listJobs: () => [],
    updateJob: (id, patch) => {
      throw new Error(`unexpected updateJob ${id} ${JSON.stringify(patch)}`)
    },
    insertRun: (run) => run,
    getRun: () => undefined,
    listRuns: () => [],
    updateRun: (id, patch) => {
      throw new Error(`unexpected updateRun ${id} ${JSON.stringify(patch)}`)
    },
    insertProviderSession: (session) => session,
    listProviderSessions: () => [],
    updateProviderSession: (id, patch) => {
      throw new Error(
        `unexpected updateProviderSession ${id} ${JSON.stringify(patch)}`,
      )
    },
    listAllRuns: () => [],
    insertEvent: (event) => event,
    listEvents: () => [],
    listAllEvents: () => [],
    insertApproval: (approval) => approval,
    getApproval: () => undefined,
    listApprovals: () => [],
    updateApproval: (id, patch) => {
      throw new Error(
        `unexpected updateApproval ${id} ${JSON.stringify(patch)}`,
      )
    },
    insertQuestion: (question) => question,
    insertArtifact: (artifact) => artifact,
    getArtifact: () => undefined,
    listArtifacts: () => [],
    ensureDefaultEmployee: () => {
      throw new Error('unexpected ensureDefaultEmployee')
    },
    insertGrowthRecord: (record) => record,
    listGrowthRecords: () => [],
    tryInsertGrowthApplication: () => true,
    recordGrowthOnce: () => ({ applied: true }),
    listGrowthApplications: () => [],
    insertWorldUnlock: (unlock) => unlock,
    listWorldUnlocks: () => [],
    insertWorldFeatureUnlock: (unlock) => unlock,
    listWorldFeatureUnlocks: () => [],
    insertAuditEntry: (entry) => entry,
    insertPack: (pack) => pack,
    updatePack: (id) => {
      throw new Error(`unexpected updatePack ${id}`)
    },
    deletePack: () => undefined,
    getPack: () => undefined,
    findPack: () => undefined,
    listPacks: () => [],
    insertJobWorktree: (record) => record,
    getJobWorktreeByJobId: () => undefined,
    listActiveWriteWorktrees: () => [],
    updateJobWorktree: (id) => {
      throw new Error(`unexpected updateJobWorktree ${id}`)
    },
    insertPackPreview: (record) => record,
    getPackPreview: () => undefined,
    deletePackPreview: () => undefined,
  }
}
