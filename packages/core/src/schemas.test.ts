import { describe, expect, it } from 'vitest'
import {
  defaultProviders,
  isPermissionEscalation,
  isProviderId,
  isRuntimeProviderId,
  isShikumiEventType,
  permissionProfileRank,
} from './domain.js'
import {
  confirmWriteRequestSchema,
  createJobRequestSchema,
  healthResponseSchema,
  installPackRequestSchema,
  jobSchema,
  portableGrowthExportSchema,
  previewPackRequestSchema,
  providerSchema,
  registerWorkspaceRequestSchema,
  resolveApprovalRequestSchema,
  workspaceSchema,
} from './schemas.js'

describe('permission profile ranks', () => {
  it('treats edit-worktree and unrestricted as escalations from research', () => {
    expect(permissionProfileRank('research')).toBeLessThan(
      permissionProfileRank('edit-worktree'),
    )
    expect(isPermissionEscalation('edit-worktree', 'research')).toBe(true)
    expect(isPermissionEscalation('unrestricted', 'research')).toBe(true)
    expect(isPermissionEscalation('observe', 'research')).toBe(false)
    expect(isPermissionEscalation('research', 'research')).toBe(false)
    expect(isPermissionEscalation('research', 'edit-worktree')).toBe(false)
  })
})

describe('registerWorkspaceRequestSchema', () => {
  it('accepts a trimmed absolute path', () => {
    expect(
      registerWorkspaceRequestSchema.parse({
        path: ' /Users/example/project ',
      }),
    ).toEqual({ path: '/Users/example/project' })
  })

  it('rejects an empty path', () => {
    expect(() =>
      registerWorkspaceRequestSchema.parse({ path: '   ' }),
    ).toThrow()
  })
})

describe('workspaceSchema', () => {
  it('accepts a persisted workspace snapshot', () => {
    const workspace = workspaceSchema.parse({
      id: 'ws_1',
      name: 'project',
      defaultProviderId: null,
      worldPackId: 'dog-office',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      repository: {
        id: 'repo_1',
        absolutePath: '/Users/example/project',
        displayName: 'project',
        currentBranch: 'main',
        remoteName: 'origin',
        remoteUrl: 'https://github.com/example/project.git',
        readable: true,
      },
    })

    expect(workspace.repository.displayName).toBe('project')
  })
})

describe('providerSchema', () => {
  it('accepts catalog providers as connected or disconnected', () => {
    for (const provider of defaultProviders) {
      expect(providerSchema.parse(provider).executionConnected).toBe(false)
    }
    expect(
      providerSchema.parse({
        id: 'codex',
        displayName: 'Codex',
        executionConnected: true,
      }).executionConnected,
    ).toBe(true)
  })
})

describe('domain guards', () => {
  it('accepts catalog provider ids and known event types only', () => {
    expect(isProviderId('codex')).toBe(true)
    expect(isProviderId('secret-provider')).toBe(false)
    expect(isProviderId('fake')).toBe(false)
    expect(isRuntimeProviderId('fake')).toBe(true)
    expect(isRuntimeProviderId('codex')).toBe(true)
    expect(isRuntimeProviderId('secret-provider')).toBe(false)
    expect(isShikumiEventType('run.state_changed')).toBe(true)
    expect(isShikumiEventType('internal.reasoning')).toBe(false)
  })
})

describe('job and health contracts', () => {
  it('allows a fake harness job without treating fake as a catalog provider', () => {
    const job = jobSchema.parse({
      id: 'job_1',
      workspaceId: 'ws_1',
      employeeId: 'saguru',
      request: '調べて',
      jobType: 'research',
      selectedProvider: 'fake',
      selectedModel: null,
      permissionProfile: 'research',
      status: 'queued',
      providerSessionId: null,
      createdAt: 't',
      startedAt: null,
      completedAt: null,
    })

    expect(job.selectedProvider).toBe('fake')
    expect(() =>
      providerSchema.parse({
        id: 'fake',
        displayName: 'Fake',
        executionConnected: false,
      }),
    ).toThrow()
  })

  it('validates job creation, approval decisions, and health', () => {
    expect(
      createJobRequestSchema.parse({
        workspaceId: 'ws_1',
        request: ' 調べて ',
      }),
    ).toEqual({
      workspaceId: 'ws_1',
      request: '調べて',
      jobType: 'research',
    })
    expect(
      createJobRequestSchema.parse({
        workspaceId: 'ws_1',
        employeeId: 'saguru',
        request: '調べて',
        selectedProvider: 'codex',
        confirmFallbackProvider: 'grok-build',
        permissionProfile: 'research',
        selectedModel: 'default',
      }).selectedProvider,
    ).toBe('codex')
    expect(
      resolveApprovalRequestSchema.parse({ decision: 'approved' }),
    ).toEqual({ decision: 'approved' })
    expect(() =>
      resolveApprovalRequestSchema.parse({ decision: 'allow-always' }),
    ).toThrow()
    expect(
      healthResponseSchema.parse({
        ok: true,
        product: 'Shikumi Local',
        phase: 'provider-adapters',
        bind: '127.0.0.1',
        persistence: 'sqlite',
        providerExecution: 'disconnected',
        fakeHarness: true,
        liveProviderRuns: false,
      }).fakeHarness,
    ).toBe(true)
    expect(
      createJobRequestSchema.parse({
        workspaceId: 'ws_1',
        request: '直して',
        permissionProfile: 'edit-worktree',
        dirtyWorktreePolicy: 'from-head',
      }).dirtyWorktreePolicy,
    ).toBe('from-head')
    expect(() =>
      createJobRequestSchema.parse({
        workspaceId: 'ws_1',
        request: '直して',
        dirtyWorktreePolicy: 'auto-import',
      }),
    ).toThrow()
  })
})

describe('worktree, growth, and pack contracts', () => {
  it('requires explicit confirmation for destructive writes', () => {
    expect(confirmWriteRequestSchema.parse({ confirm: true })).toEqual({
      confirm: true,
    })
    expect(() => confirmWriteRequestSchema.parse({ confirm: false })).toThrow()
    expect(
      installPackRequestSchema.parse({
        previewId: 'prev_1',
        confirm: true,
      }).previewId,
    ).toBe('prev_1')
    expect(
      previewPackRequestSchema.parse({
        sourceType: 'folder',
        path: '/tmp/pack',
      }).sourceType,
    ).toBe('folder')
  })

  it('keeps portable growth export free of secrets and absolute paths', () => {
    const exported = portableGrowthExportSchema.parse({
      generatedAt: '2026-08-18T00:00:00.000Z',
      employees: [
        {
          employeeId: 'saguru',
          employeeName: 'サグル',
          level: 2,
          metrics: [{ id: 'completed_jobs', label: '完了した仕事', value: 5 }],
          workspaces: [
            {
              workspaceId: 'ws_1',
              workspaceName: 'workshop',
              level: 1,
              metrics: [
                { id: 'completed_jobs', label: '完了した仕事', value: 2 },
              ],
              unlocks: ['bookshelf-small'],
            },
          ],
        },
      ],
    })
    expect(JSON.stringify(exported)).not.toContain('/Users/')
    expect(JSON.stringify(exported)).not.toContain('reasoning')
  })
})
