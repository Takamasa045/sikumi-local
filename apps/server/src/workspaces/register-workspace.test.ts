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
      () => inspection,
    )

    expect(workspace.repository.absolutePath).toBe('/Users/example/project')
    expect(store.listWorkspaces()).toHaveLength(1)
  })

  it('rejects a duplicate real path', () => {
    const store = createMemoryStore()
    const inspection = sampleInspection('/Users/example/project')
    registerWorkspace(store, '/Users/example/project', () => inspection)

    try {
      registerWorkspace(store, '/Users/example/project', () => inspection)
      throw new Error('expected REPOSITORY_DUPLICATE')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('REPOSITORY_DUPLICATE')
    }
  })

  it('rejects path traversal before inspection', () => {
    const store = createMemoryStore()

    expect(() =>
      registerWorkspace(store, '/Users/example/../secret', () => {
        throw new Error('inspect should not run')
      }),
    ).toThrow(AppError)
  })
})

function sampleInspection(absolutePath: string): GitInspection {
  return {
    absolutePath,
    displayName: 'project',
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
    createWorkspace: (inspection) => {
      const workspace: Workspace = {
        id: `ws_${workspaces.length + 1}`,
        name: inspection.displayName,
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
