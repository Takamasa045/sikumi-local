import { describe, expect, it } from 'vitest'
import {
  defaultProviders,
  isProviderId,
  isRuntimeProviderId,
  isShikumiEventType,
} from './domain.js'
import {
  createJobRequestSchema,
  healthResponseSchema,
  jobSchema,
  providerSchema,
  registerWorkspaceRequestSchema,
  resolveApprovalRequestSchema,
  workspaceSchema,
} from './schemas.js'

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
  it('keeps every catalog provider disconnected in this phase', () => {
    for (const provider of defaultProviders) {
      expect(providerSchema.parse(provider).executionConnected).toBe(false)
    }
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
      resolveApprovalRequestSchema.parse({ decision: 'approved' }),
    ).toEqual({ decision: 'approved' })
    expect(() =>
      resolveApprovalRequestSchema.parse({ decision: 'allow-always' }),
    ).toThrow()
    expect(
      healthResponseSchema.parse({
        ok: true,
        product: 'Shikumi Local',
        phase: 'provider-sdk-and-fake',
        bind: '127.0.0.1',
        persistence: 'sqlite',
        providerExecution: 'disconnected',
        fakeHarness: true,
      }).fakeHarness,
    ).toBe(true)
  })
})
